import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerQuestion } from './bot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT ?? 3000);

const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
};
const sessionStore = new Map();
const maxSessionMessages = 12;

function parseCookies(cookieHeader = '') {
    return Object.fromEntries(
        cookieHeader
            .split(';')
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => {
                const separatorIndex = item.indexOf('=');
                const key = separatorIndex >= 0 ? item.slice(0, separatorIndex) : item;
                const value = separatorIndex >= 0 ? item.slice(separatorIndex + 1) : '';
                return [key, decodeURIComponent(value)];
            })
    );
}

function getSession(request, response) {
    const cookies = parseCookies(request.headers.cookie);
    let sessionId = cookies.sessionId;

    if (!sessionId) {
        sessionId = crypto.randomUUID();
        response.setHeader('Set-Cookie', `sessionId=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
    }

    if (!sessionStore.has(sessionId)) {
        sessionStore.set(sessionId, []);
    }

    return {
        sessionId,
        history: sessionStore.get(sessionId),
    };
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
}

async function serveStatic(response, filePath) {
    try {
        const resolvedPath = path.join(publicDir, filePath === '/' ? 'index.html' : filePath.slice(1));
        const data = await readFile(resolvedPath);
        const extension = path.extname(resolvedPath);

        response.writeHead(200, {
            'Content-Type': contentTypes[extension] ?? 'application/octet-stream',
        });
        response.end(data);
    } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
    }
}

const server = createServer(async (request, response) => {
    if (!request.url) {
        response.writeHead(400);
        response.end();
        return;
    }

    if (request.method === 'POST' && request.url === '/api/chat') {
        try {
            const session = getSession(request, response);
            let body = '';

            for await (const chunk of request) {
                body += chunk;
            }

            const { message } = JSON.parse(body);

            if (!message?.trim()) {
                sendJson(response, 400, { error: 'Message is required.' });
                return;
            }

            const cleanMessage = message.trim();
            const result = await answerQuestion(cleanMessage, session.history);

            session.history.push(
                { role: 'user', content: cleanMessage },
                { role: 'assistant', content: result.answer }
            );

            if (session.history.length > maxSessionMessages) {
                session.history.splice(0, session.history.length - maxSessionMessages);
            }

            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, 500, { error: error.message });
        }

        return;
    }

    if (request.method === 'POST' && request.url === '/api/reset') {
        const session = getSession(request, response);
        session.history.length = 0;
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method === 'GET') {
        await serveStatic(response, request.url === '/' ? '/' : request.url.split('?')[0]);
        return;
    }

    response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Method not allowed');
});

server.listen(port, () => {
    console.log(`Web chat running at http://localhost:${port}`);
});
