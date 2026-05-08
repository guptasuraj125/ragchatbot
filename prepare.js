import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { ChromaClient, CloudClient } from 'chromadb';
import { pipeline } from '@xenova/transformers';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse/lib/pdf-parse.js');

const collectionName = process.env.CHROMA_COLLECTION ?? 'company-docs';
const chromaHost = process.env.CHROMA_HOST;
const chromaUrl = process.env.CHROMA_URL ?? (chromaHost ? `https://${chromaHost}` : 'http://127.0.0.1:8000');
const chromaCloudApiKey = process.env.CHROMA_API_KEY;
const chromaTenant = process.env.CHROMA_TENANT;
const chromaDatabase = process.env.CHROMA_DATABASE;

let extractorPromise;
let vectorStorePromise;

function createChromaIndex() {
    const host = chromaHost ?? new URL(chromaUrl).hostname;
    const ssl = chromaCloudApiKey ? true : new URL(chromaUrl).protocol === 'https:';
    const port = new URL(chromaUrl).port ? Number(new URL(chromaUrl).port) : (ssl ? 443 : 8000);

    if (chromaCloudApiKey) {
        return new CloudClient({
            apiKey: chromaCloudApiKey,
            host,
            port,
            ...(chromaTenant ? { tenant: chromaTenant } : {}),
            ...(chromaDatabase ? { database: chromaDatabase } : {}),
        });
    }

    return new ChromaClient({
        host,
        port,
        ssl,
        ...(chromaTenant ? { tenant: chromaTenant } : {}),
        ...(chromaDatabase ? { database: chromaDatabase } : {}),
    });
}

function getExtractor() {
    if (!extractorPromise) {
        extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }

    return extractorPromise;
}

const embeddings = {
    async embedDocuments(texts) {
        const extractor = await getExtractor();

        return Promise.all(texts.map(async (text) => {
            const output = await extractor(text, { pooling: 'mean', normalize: true });
            return Array.from(output.data);
        }));
    },
    async embedQuery(text) {
        const extractor = await getExtractor();
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }
};

export async function getVectorStore() {
    if (!vectorStorePromise) {
        vectorStorePromise = Chroma.fromExistingCollection(embeddings, {
            collectionName,
            index: createChromaIndex(),
        });
    }

    return vectorStorePromise;
}

function buildChunkId(filePath, chunkIndex) {
    return crypto
        .createHash('sha1')
        .update(`${filePath}:${chunkIndex}`)
        .digest('hex');
}

export async function indexTheDocument(filePath) {
    const buffer = await readFile(filePath);
    const parsedPdf = await pdf(buffer);
    const sourceText = parsedPdf.text?.trim();

    if (!sourceText) {
        throw new Error(`No readable text found in ${filePath}`);
    }

    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 100,
    });

    const texts = await splitter.splitText(sourceText);
    const documents = texts.map((text, chunkIndex) => ({
        pageContent: text,
        metadata: {
            source: filePath,
            chunkIndex,
            totalPages: parsedPdf.numpages,
        },
    }));
    const ids = documents.map((_, chunkIndex) => buildChunkId(filePath, chunkIndex));
    const vectorStore = await getVectorStore();

    await vectorStore.addDocuments(documents, { ids });

    console.log(`Indexed ${documents.length} chunks into Chroma collection "${collectionName}" at ${chromaUrl}`);
}
