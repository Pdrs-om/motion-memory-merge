import express from "express";

const app = express();
const port = process.env.PORT || 3000;

// Pour lire du JSON dans les requêtes
app.use(express.json());

// Healthcheck simple pour Railway
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "motion-memory-merge" });
});

// Endpoint de merge (squelette, à compléter ensuite)
app.post("/merge", async (req, res) => {
  try {
    const { videoUrls } = req.body;

    if (!Array.isArray(videoUrls) || videoUrls.length < 2) {
      return res.status(400).json({
        error: "Il faut fournir au moins 2 URLs de vidéos dans videoUrls[]",
      });
    }

    // TODO: ici on implémentera la vraie logique ffmpeg côté serveur.
    // Pour l’instant, on renvoie juste ce qu’on a reçu, pour tester le pipeline.
    return res.json({
      ok: true,
      received: videoUrls,
      message:
        "API merge en place. La logique ffmpeg sera branchée dans un second temps.",
    });
  } catch (err) {
    console.error("[merge] Error:", err);
    return res.status(500).json({ error: "Erreur interne serveur" });
  }
});

app.listen(port, () => {
  console.log(`Merge service listening on port ${port}`);
});
