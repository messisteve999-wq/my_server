require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 8787;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const apps = {};

(process.env.APP_KEYS || "").split(",").forEach(item => {
  const [name, key] = item.split(":");
  if (name && key) apps[name] = key;
});

function authenticate(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key) return res.status(401).json({
    success: false,
    error: "API key required"
  });

  const valid = Object.entries(apps).find(([name, saved]) => {
    const a = Buffer.from(key);
    const b = Buffer.from(saved);
    return a.length === b.length &&
      crypto.timingSafeEqual(a, b) ? name : false;
  });

  if (!valid) return res.status(403).json({
    success: false,
    error: "Invalid application key"
  });

  req.appName = valid[0];
  next();
}

app.get("/health", (req, res) => {
  res.json({
    success: true,
    server: "MY_SERVER",
    model: MODEL,
    status: "online"
  });
});

app.post("/v1/generate", authenticate, async (req, res) => {
  try {
    const prompt = req.body.prompt;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        success: false,
        error: "Prompt required"
      });
    }

    const result = await ai.models.generateContent({
      model: MODEL,
      contents: prompt
    });

    res.json({
      success: true,
      server: "MY_SERVER",
      application: req.appName,
      model: MODEL,
      text: result.text || ""
    });

  } catch (error) {
    console.error("Gemini error:", error.message);
    res.status(500).json({
      success: false,
      error: "Gemini generation failed"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("MY_SERVER démarré sur le port " + PORT);
  console.log("Modèle : " + MODEL);
  console.log("Applications : " + Object.keys(apps).join(", "));
});
