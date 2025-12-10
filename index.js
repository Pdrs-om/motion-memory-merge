const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const util = require("util");
const fs = require("fs").promises;
const fsSync = require("fs");
const http = require("http");
const https = require("https");

const execFileAsync = util.promisify(execFile);

const app = express();
const PORT = process.env.PORT || 8080;

// CORS pour autoriser l'appel depuis ton front (Lovable / motion-memory.com)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// Pour accepter un body JSON assez gros (URLs, plus tard config FFmpeg)
app.use(express.json({ limit: "200mb" }));

// Petite route de santé pour tester dans le navigateur
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "motion-memory-merge" });
});

// Réponse au preflight CORS (OPTIONS /merge)
app.options("/merge", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.status(204).send();
});

/**
 * Télécharge une vidéo à partir d'une URL (Supabase signed URL)
 * et la sauvegarde dans /tmp/input_X.mp4
 */
async function downloadToTmp(fileUrl, index) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(fileUrl);
      const client = urlObj.protocol === "https:" ? https : http;
      const tmpPath = `/tmp/input_${index}.mp4`;
      const fileStream = fsSync.createWriteStream(tmpPath);

      const req = client.get(urlObj, (response) => {
        if (response.statusCode !== 200) {
          return reject(
            new Error(`Download failed (${response.statusCode}) for ${fileUrl}`)
          );
        }
        response.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close(() => resolve(tmpPath));
        });
      });

      req.on("error", (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Lit la taille (width/height) de la vidéo avec ffprobe
 */
async function getVideoSize(inputPath) {
  const args = [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    inputPath,
  ];

  const { stdout } = await execFileAsync("ffprobe", args);
  const info = JSON.parse(stdout);
  const stream = info.streams && info.streams[0];
  if (!stream || !stream.width || !stream.height) {
    throw new Error(`Unable to read video size for ${inputPath}`);
  }
  return { width: stream.width, height: stream.height };
}

/**
 * Normalise UNE vidéo dans un format cible (targetW x targetH)
 * en conservant le ratio d'origine : scale + pad (bandes noires).
 * On corrige aussi les timestamps problématiques des vidéos générées (Veo, etc.)
 */
async function normalizeVideo(inputPath, index, targetW, targetH) {
  const normalizedPath = `/tmp/norm_${index}.mp4`;

  const filter = [
    // Redimensionne au max dans le cadre sans déformer
    `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
    // Centre dans un canvas fixe, ajoute des bandes noires si besoin
    `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`,
  ].join(",");

  const args = [
    "-y",
    "-fflags",
    "+genpts", // régénère les timestamps
    "-i",
    inputPath,
    "-vf",
    filter,
    "-vsync",
    "cfr", // framerate constant pour éviter les timecodes bizarres
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-an", // pas d'audio pour l'instant
    normalizedPath,
  ];

  console.log("[ffmpeg normalize] running:", ["ffmpeg", ...args].join(" "));

  const { stdout, stderr } = await execFileAsync("ffmpeg", args);
  if (stdout) console.log("[ffmpeg normalize stdout]", stdout);
  if (stderr) console.log("[ffmpeg normalize stderr]", stderr);

  return normalizedPath;
}

/**
 * Concatène toutes les vidéos normalisées (mêmes dimensions)
 * en un seul fichier MP4.
 */
async function concatVideos(inputPaths, outputPath) {
  const concatList = inputPaths.map((p) => `file '${p}'`).join("\n");
  const concatFile = "/tmp/inputs.txt";
  await fs.writeFile(concatFile, concatList);

  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFile,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  console.log("[ffmpeg concat] running:", ["ffmpeg", ...args].join(" "));

  const { stdout, stderr } = await execFileAsync("ffmpeg", args);
  if (stdout) console.log("[ffmpeg concat stdout]", stdout);
  if (stderr) console.log("[ffmpeg concat stderr]", stderr);
}

/**
 * Endpoint de fusion
 * Règle de format :
 *  - On regarde la première vidéo
 *  - si width >= height → sortie 1280x720 (paysage)
 *  - sinon → sortie 720x1280 (portrait)
 */
app.post("/merge", async (req, res) => {
  const { videoUrls, audioUrl } = req.body || {};
  console.log("[/merge] request body", { videoUrls, audioUrl });

  if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
    return res.status(400).json({ error: "videoUrls array is required" });
  }

  try {
    // 1. Télécharger toutes les vidéos dans /tmp
    const rawPaths = [];
    for (let i = 0; i < videoUrls.length; i++) {
      const p = await downloadToTmp(videoUrls[i], i);
      rawPaths.push(p);
    }

    // 2. Déterminer le format de sortie à partir de la première vidéo
    const firstSize = await getVideoSize(rawPaths[0]);
    const isLandscape = firstSize.width >= firstSize.height;

    // on reste en 720p natif pour éviter l'upscale et limiter la charge
    const targetW = isLandscape ? 1280 : 720;
    const targetH = isLandscape ? 720 : 1280;

    console.log(
      "[/merge] target format",
      isLandscape ? "landscape" : "portrait",
      `${targetW}x${targetH}`
    );

    // 3. Normaliser chaque vidéo vers ce format
    const normalizedPaths = [];
    for (let i = 0; i < rawPaths.length; i++) {
      const norm = await normalizeVideo(rawPaths[i], i, targetW, targetH);
      normalizedPaths.push(norm);
    }

    // 4. Concaténer les vidéos normalisées
    const outputPath = "/tmp/output.mp4";
    await concatVideos(normalizedPaths, outputPath);

    // 5. Lire le fichier résultant et le renvoyer
    const buffer = await fs.readFile(outputPath);
    res.setHeader("Content-Type", "video/mp4");
    res.send(buffer);
  } catch (err) {
    console.error("[/merge] error", err);
    res.status(500).json({
      error: err.message || "merge_failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`motion-memory-merge listening on port ${PORT}`);
});
