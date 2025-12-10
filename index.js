const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

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

// Pour accepter un body JSON assez gros (URLs, plus tard config audio)
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

// Helper : téléchargement d'une vidéo dans /tmp
async function downloadToTmp(url, index) {
  console.log(`[downloadToTmp] downloading #${index} from`, url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed for ${url} with status ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const filePath = `/tmp/input_${index}.mp4`;
  await fs.writeFile(filePath, Buffer.from(arrayBuffer));
  return filePath;
}

// Helper : concaténation avec ffmpeg
async function concatVideos(inputPaths, outputPath) {
  // Crée le fichier de concat pour ffmpeg
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
    "-vf",
    "scale=1280:-2,format=yuv420p",
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

  console.log("[ffmpeg] running:", ["ffmpeg", ...args].join(" "));

  const { stdout, stderr } = await execFileAsync("ffmpeg", args);
  if (stdout) console.log("[ffmpeg stdout]", stdout);
  if (stderr) console.log("[ffmpeg stderr]", stderr);
}

// Endpoint de fusion
app.post("/merge", async (req, res) => {
  const { videoUrls, audioUrl } = req.body || {};
  console.log("[/merge] request body", { videoUrls, audioUrl });

  if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
    return res.status(400).json({ error: "videoUrls array is required" });
  }

  try {
    // 1. Télécharger toutes les vidéos dans /tmp
    const inputPaths = [];
    for (let i = 0; i < videoUrls.length; i++) {
      const p = await downloadToTmp(videoUrls[i], i);
      inputPaths.push(p);
    }

    // 2. Lancer ffmpeg pour concaténer
    const outputPath = "/tmp/output.mp4";
    await concatVideos(inputPaths, outputPath);

    // 3. Lire le fichier résultant et le renvoyer
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
