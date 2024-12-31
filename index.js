import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import path from "path";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-", // Your OpenAI API key here
});

const app = express();
app.use(express.json());
const corsOptions = {
  origin: '*', // Allow only requests from this origin
  methods: 'GET,POST', // Allow only these methods
  allowedHeaders: ['Content-Type', 'Authorization'] // Allow only these headers
};


app.use(cors(corsOptions));
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);
  await execCommand(
    `ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);
  await execCommand(
    `./bin/rhubarb/rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
  );
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  if (!userMessage) {
    return res.status(400).send({
      error: "Message input is required.",
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1000,
      temperature: 0.6,
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: `
          You are a virtual friend and language tutor.
          Always respond in JSON format, structured as an **array of objects**. Each object in the array represents a message and has:
            - "text": The response text in Moroccan Darija (in Arabic script).
            - "facialExpression": One of "smile", "sad", "angry", "surprised", "funnyFace", "default".
            - "animation": One of "Talking_1", "Talking_2", "Talking_3", "Crying", "Laughing", "Dancing", "Idle", "Terrified", "Angry".
            - "feedback": A detailed evaluation of the user's input in English. Mention if there are any pronunciation or grammar issues. Include the Arabic Darija word and its pronunciation directly in the feedback.

          Example JSON response:
          [
            {
              "text": "مرحبا! كيف حالك؟",
              "facialExpression": "smile",
              "animation": "Talking_1",
              "feedback": "Your pronunciation of 'كيف' (kayf) was slightly off. It should be more like 'kayf'. Your grammar was good overall."
            },
            {
              "text": "أنا بخير، وأنت؟",
              "facialExpression": "smile",
              "animation": "Talking_2",
              "feedback": "Great job! Your pronunciation and grammar were perfect."
            }
          ]

          Make sure your output always matches this format. Respond with multiple messages if needed, but the structure must be consistent.
          `,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    if (
      !completion ||
      !completion.choices ||
      !completion.choices[0] ||
      !completion.choices[0].message
    ) {
      console.error("Invalid OpenAI response:", completion);
      return res.status(500).send({ error: "Invalid AI response." });
    }

    let messages;

    try {
      const parsedResponse = JSON.parse(completion.choices[0].message.content);

      // Check if the parsed response is an array; if not, wrap it in an array
      if (Array.isArray(parsedResponse)) {
        messages = parsedResponse;
      } else if (typeof parsedResponse === "object" && parsedResponse !== null) {
        messages = [parsedResponse];
      } else {
        throw new Error("Unexpected response format");
      }
    } catch (error) {
      console.error("Error parsing OpenAI response:", error);
      return res.status(500).send({ error: "Failed to parse AI response." });
    }

    console.log("Parsed Messages:", messages);

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const fileName = `audios/message_${i}.mp3`;
      const textInput = message.text;

      const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: "fable",
        input: textInput,
      });
      const buffer = Buffer.from(await mp3.arrayBuffer());
      await fs.writeFile(fileName, buffer);

      await lipSyncMessage(i);

      message.audio = await audioFileToBase64(fileName);
      message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
    }

    res.send({ messages });
  } catch (error) {
    console.error("Error handling chat request:", error);
    res.status(500).send({ error: "Internal Server Error." });
  }
});





const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.listen(port, () => {
  console.log(`Virtual Girlfriend listening on port ${port}`);
});
