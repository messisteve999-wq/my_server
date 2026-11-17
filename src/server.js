require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 8787;

const PRIMARY_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY manquante dans .env");
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const apps = {};

(process.env.APP_KEYS || "").split(",").forEach(item => {
  const [name, key] = item.split(":");
  if (name && key) apps[name] = key;
});


console.log(
  "NEW KEY FINGERPRINT:",
  apps.NEW
    ? require("crypto").createHash("sha256")
        .update(apps.NEW)
        .digest("hex")
        .slice(0, 16)
    : "MISSING"
);

// Authentification des applications
function authenticate(req, res, next) {
  const key = req.headers["x-api-key"];

  if (!key) {
    return res.status(401).json({
      success: false,
      error: "API key required"
    });
  }

  const valid = Object.entries(apps).find(([, saved]) => {
    const a = Buffer.from(key);
    const b = Buffer.from(saved);

    return a.length === b.length &&
      crypto.timingSafeEqual(a, b);
  });

  if (!valid) {
    return res.status(403).json({
      success: false,
      error: "Invalid application key"
    });
  }

  req.appName = valid[0];
  next();
}

// Identifier les erreurs temporaires
function isTemporaryError(error) {
  const status = Number(
    error?.status ||
    error?.code ||
    error?.response?.status
  );

  const message = String(error?.message || error);

  return [408, 429, 500, 502, 503, 504].includes(status) ||
    /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|temporarily|timeout|abort|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message);
}

// Génération avec basculement automatique
async function generateWithFallback(prompt) {
  try {
    console.log("Gemini principal :", PRIMARY_MODEL);

    const result = await ai.models.generateContent({
      model: PRIMARY_MODEL,
      contents: prompt
    });

    return {
      result,
      model: PRIMARY_MODEL,
      fallbackUsed: false
    };

  } catch (primaryError) {
    console.error(
      "Erreur modèle principal :",
      primaryError.message
    );

    if (
      !isTemporaryError(primaryError) ||
      !FALLBACK_MODEL ||
      FALLBACK_MODEL === PRIMARY_MODEL
    ) {
      throw primaryError;
    }

    console.log(
      "BASCULEMENT AUTOMATIQUE VERS :",
      FALLBACK_MODEL
    );

    try {
      const result = await ai.models.generateContent({
        model: FALLBACK_MODEL,
        contents: prompt
      });

      return {
        result,
        model: FALLBACK_MODEL,
        fallbackUsed: true
      };

    } catch (fallbackError) {
      console.error(
        "Erreur modèle de secours :",
        fallbackError.message
      );

      throw fallbackError;
    }
  }
}

// Vérification du serveur
app.get("/health", (req, res) => {
  res.json({
    success: true,
    server: "MY_SERVER",
    model: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    status: "online"
  });
});
let activeGenerations = 0;
const MAX_CONCURRENT_GENERATIONS = 2;
// API de génération IA

app.post("/v1/generate", authenticate, async (req, res) => {
  const prompt = req.body.prompt;

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({
      success: false,
      error: "Prompt required"
    });
  }

  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    return res.status(503).json({
      success: false,
      error: "Server busy",
      message: "Please retry shortly."
    });
  }

  activeGenerations++;

  try {
    const output = await generateWithFallback(prompt);

    res.json({
      success: true,
      server: "MY_SERVER",
      application: req.appName,
      model: output.model,
      fallbackUsed: output.fallbackUsed,
      text: output.result.text || ""
    });

  } catch (error) {
    console.error("GENERATION FAILED:", error.message);

    res.status(isTemporaryError(error) ? 503 : 502).json({
      success: false,
      server: "MY_SERVER",
      error: "AI generation unavailable",
      message: "Please try again later."
    });

  } finally {
    activeGenerations--;
  }
});


// Démarrage
app.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("STEVE SERVER DEMARRE");
  console.log("Port :", PORT);
  console.log("Principal :", PRIMARY_MODEL);
  console.log("Secours :", FALLBACK_MODEL);
  console.log("Applications :", Object.keys(apps).join(", "));
  console.log("================================");
});
