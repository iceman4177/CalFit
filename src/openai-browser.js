// src/openaiClient.js
import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,    // VITE_ prefix is required in Vite
  dangerouslyAllowBrowser: true,                  // you must opt in for browser use
});
