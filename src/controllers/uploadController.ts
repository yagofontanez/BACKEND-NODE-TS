import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const isBase64 = (str: string) => {
  const base64Regex =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  return base64Regex.test(str);
};

const isValidDateTime = (datetime: string): boolean => {
  const date = new Date(datetime);
  return !isNaN(date.getTime()) && date.toISOString() === datetime;
};

export const uploadImage = async (req: Request, res: Response) => {
  const { image, customer_code, measure_datetime, measure_type } = req.body;

  const apiGeminiKey = process.env.GEMINI_API_KEY;

  if (!apiGeminiKey) {
    return res.status(500).json({ error: "API key is not defined." });
  }

  if (typeof image !== "string" || !isBase64(image)) {
    return res
      .status(400)
      .json({ error: "Invalid image format. Expected base64 string." });
  }

  if (!["WATER", "GAS"].includes(measure_type)) {
    return res
      .status(400)
      .json({ error: 'Invalid measure type. Expected "WATER" or "GAS".' });
  }

  if (typeof customer_code !== "string" || customer_code.trim() === "") {
    return res
      .status(400)
      .json({ error: "Invalid customer code. Expected non-empty string." });
  }

  if (!isValidDateTime(measure_datetime)) {
    return res
      .status(400)
      .json({
        error: "Invalid measure_datetime. Expected a valid ISO 8601 datetime string.",
      });
  }

  const currentDate = new Date(measure_datetime);
  const month = currentDate.getMonth() + 1;
  const year = currentDate.getFullYear();

  const alreadyExists = false;

  if (alreadyExists) {
    return res
      .status(409)
      .json({
        error_code: "DOUBLE_REPORT",
        error_description: "Leitura do mês já realizada.",
      });
  }

  const guid = uuidv4();

  const buffer = Buffer.from(image, "base64");

  const filePath = path.join(__dirname, `../../uploads/${guid}.png`);

  fs.writeFileSync(filePath, buffer);

  try {
    const fileManager = new GoogleAIFileManager(apiGeminiKey);
    const uploadResponse = await fileManager.uploadFile(filePath, {
      mimeType: "image/jpeg",
      displayName: "medição",
    });

    const genAI = new GoogleGenerativeAI(apiGeminiKey);

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
    });

    const result: any = await model.generateContent([
      {
        fileData: {
          mimeType: uploadResponse.file.mimeType,
          fileUri: uploadResponse.file.uri,
        },
      },
      { text: "Tell me the measurement of this meter." },
    ]);

    const text = result.response.candidates[0].content.parts[0].text;

    const regex = /(\d+)\s*m³/;
    const match = text.match(regex);
    let extractedValue;

    if (match && match[1]) {
      extractedValue = parseInt(match[1], 10);
    } else {
      console.log("Não foi possível extrair o valor da medição.");
    }

    const temporaryLink = `http://localhost:3000/uploads/${guid}.png`;

    res.json({
      image_rl: temporaryLink,
      measure_value: extractedValue,
      measure_uuid: guid,
    });
  } catch (error) {
    console.error("Error processing image with Gemini:", error);
    res.status(400).json({
        error_code: "INVALID_DATA",
        error_description: error,
    });
  }
};
