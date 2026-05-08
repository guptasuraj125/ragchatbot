import { indexTheDocument } from './prepare.js';

const filePath = './cg-internal-docs.pdf';

try {
    await indexTheDocument(filePath);
} catch (error) {
    console.error('Indexing failed.');
    console.error('Make sure ChromaDB is running and CHROMA_URL points to it.');
    console.error(`Details: ${error.message}`);
    process.exit(1);
}
