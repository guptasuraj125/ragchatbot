import { readFileSync } from 'node:fs';
import path from 'node:path';
import Groq from 'groq-sdk';
import { fileURLToPath } from 'node:url';
import { getVectorStore } from './prepare.js';

if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY missing in .env');
}

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const model = process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b';
const maxHistoryTurns = 8;
const systemPrompt = readFileSync(path.join(__dirname, 'system-prompt.txt'), 'utf8').trim();

function buildHistoryText(history = []) {
    return history
        .slice(-maxHistoryTurns)
        .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
        .join('\n');
}

function cleanText(text) {
    return text
        .replace(/\*/g, '')
        .replace(/\r/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*-\s*/g, ' - ')
        .trim();
}

function looksLikeListQuestion(question) {
    return /\b(list|leadership|names|team|members|steps|points|all)\b/i.test(question);
}

function formatListAnswer(answer) {
    const cleaned = cleanText(answer);
    const normalized = cleaned
        .replace(/\s+-\s+(CEO|CTO|COO|CFO|CMO|Head of [^:]+|Founder|Co-Founder|Director|Manager)\s*:/gi, '\n- $1:')
        .replace(/\s+-\s+/g, '\n- ');

    const lines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (!lines.length) {
        return cleaned;
    }

    if (lines.length === 1) {
        return lines[0];
    }

    const [firstLine, ...restLines] = lines;
    const intro = firstLine.endsWith(':') ? firstLine : `${firstLine}`;
    const items = restLines.map((line) => line.startsWith('-') ? line : `- ${line}`);

    return [intro, ...items].join('\n');
}

function formatAnswer(question, answer) {
    const cleaned = cleanText(answer);

    if (looksLikeListQuestion(question)) {
        return formatListAnswer(cleaned);
    }

    return cleaned;
}

export async function answerQuestion(question, history = []) {
    const vectorStore = await getVectorStore();
    const relevantChunks = await vectorStore.similaritySearch(question, 3);
    const context = relevantChunks.length
        ? relevantChunks.map((chunk) => chunk.pageContent).join('\n\n')
        : 'No relevant context found.';
    const conversationHistory = buildHistoryText(history);

    const completion = await groq.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: `Conversation history:\n${conversationHistory || 'No previous conversation.'}\n\nQuestion: ${question}\n\nContext:\n${context}\n\nAnswer:`
            },
        ],
        model,
    });

    return {
        answer: formatAnswer(question, completion.choices[0].message.content ?? "I don't know."),
        context,
    };
}
