import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "CodeSail Backend is running!" });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "CodeSail API" });
});

app.listen(PORT, () => {
  console.log(`CodeSail backend running at http://localhost:${PORT}`);
});
