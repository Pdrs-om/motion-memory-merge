const express = require("express");
const cors = require("cors");

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

// Endpoint de fusion (pour l'instant : stub de test)
app.post("/merge", async (req, res) => {
  const { videoUrls, audioUrl } = req.body || {};
  console.log("[/merge] request body", { videoUrls, audioUrl });

  if (!Array.isArray(videoUrls) || videoUrls.length === 0) {
    return res.status(400).json({ error: "videoUrls array is required" });
  }

  // TODO: ici on branchera la vraie fusion FFmpeg.
  // Pour le moment on renvoie juste un JSON pour vérifier que l'appel passe.
  return res.json({
    ok: true,
    message: "Backend reachable, CORS OK. Fusion à implémenter.",
    videoCount: videoUrls.length,
  });
});

app.listen(PORT, () => {
  console.log(`motion-memory-merge listening on port ${PORT}`);
});
