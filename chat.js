import readline from 'node:readline/promises';
import { answerQuestion } from './bot.js';
import { getVectorStore } from './prepare.js';

async function chat() {
    try {
        await getVectorStore();
    } catch (error) {
        console.error('Unable to connect to ChromaDB.');
        console.error('Check your Chroma Cloud or local Chroma settings in .env.');
        console.error(`Details: ${error.message}`);
        process.exit(1);
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log('Chatbot started (type /bye to exit)\n');

    while (true) {
        const question = await rl.question('You: ');

        if (!question.trim()) continue;

        if (question === '/bye') {
            console.log('Bye!');
            break;
        }

        try {
            const result = await answerQuestion(question);
            console.log(`Assistant: ${result.answer}\n`);
        } catch (error) {
            console.error(`Error: ${error.message}`);
        }
    }

    rl.close();
}

chat();
