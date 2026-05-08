const form = document.getElementById('chatForm');
const input = document.getElementById('messageInput');
const messages = document.getElementById('messages');
const sendButton = document.getElementById('sendButton');
const pdfInput = document.getElementById('pdfInput');
const uploadStatus = document.getElementById('uploadStatus');

const storageKey = 'suraj-rag-chat-session';

const isLocalStaticPreview =
    ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
    window.location.port &&
    window.location.port !== '8000';

const apiBase = isLocalStaticPreview
    ? 'http://127.0.0.1:8000'
    : '';

function sanitizeResponseText(text) {
    return text
        .replace(/\*/g, '')
        .replace(/\s+\n/g, '\n')
        .replace(/\n\s+/g, '\n')
        .trim();
}

function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
}

function createMessage(role, text = '') {
    const article = document.createElement('article');
    article.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';

    const image = document.createElement('img');

    image.alt = role === 'user'
        ? 'User avatar'
        : 'AI avatar';

    image.src = role === 'user'
        ? 'https://api.dicebear.com/9.x/initials/svg?seed=U'
        : 'https://api.dicebear.com/9.x/shapes/svg?seed=rag';

    avatar.appendChild(image);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;

    article.append(avatar, bubble);
    messages.appendChild(article);

    scrollToBottom();

    return bubble;
}

function saveMessages() {
    sessionStorage.setItem(storageKey, messages.innerHTML);
}

function restoreMessages() {
    const saved = sessionStorage.getItem(storageKey);

    if (saved) {
        messages.innerHTML = saved;
        scrollToBottom();
    }
}

async function parseResponse(response) {
    const rawText = await response.text();

    if (!rawText) {
        return {};
    }

    try {
        return JSON.parse(rawText);
    } catch {
        return { detail: rawText };
    }
}

async function typeWords(element, text) {
    const safeText = sanitizeResponseText(text);

    const tokens = safeText.match(/[^\s]+\s*/g) ?? [];

    element.classList.add('typing');
    element.textContent = '';

    for (const token of tokens) {
        element.textContent += token;

        scrollToBottom();

        await new Promise((resolve) =>
            setTimeout(resolve, 22)
        );
    }

    if (!tokens.length) {
        element.textContent = safeText;
    }

    element.classList.remove('typing');

    saveMessages();
}

function setLoading(isLoading) {
    sendButton.disabled = isLoading;
    input.disabled = isLoading;
    pdfInput.disabled = isLoading;
}

input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
});

input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
    }
});

restoreMessages();

pdfInput.addEventListener('change', async () => {
    const file = pdfInput.files?.[0];

    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    uploadStatus.textContent = 'Uploading PDF...';

    setLoading(true);

    try {
        const response = await fetch(`${apiBase}/api/upload`, {
            method: 'POST',
            body: formData,
        });

        const data = await parseResponse(response);

        if (!response.ok) {
            throw new Error(data.detail ?? 'Upload failed');
        }

        uploadStatus.textContent =
            `${data.document_name} uploaded`;

        createMessage(
            'assistant',
            `${data.document_name} uploaded successfully. You can start chatting now.`
        );

        saveMessages();

    } catch (error) {

        uploadStatus.textContent = 'Upload failed';

        createMessage(
            'assistant',
            `Error: ${error.message}`
        );

        saveMessages();

    } finally {

        setLoading(false);
        pdfInput.value = '';
    }
});

form.addEventListener('submit', async (event) => {

    event.preventDefault();

    const message = input.value.trim();

    if (!message) return;

    createMessage('user', message);

    saveMessages();

    input.value = '';
    input.style.height = 'auto';

    setLoading(true);

    const assistantBubble = createMessage('assistant', '');

    assistantBubble.textContent = 'Thinking...';

    try {

        const response = await fetch(`${apiBase}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });

        const data = await parseResponse(response);

        if (!response.ok) {
            throw new Error(
                data.detail ??
                data.error ??
                'Request failed'
            );
        }

        await typeWords(
            assistantBubble,
            sanitizeResponseText(data.answer)
        );

    } catch (error) {

        assistantBubble.textContent =
            `Error: ${error.message}`;

        saveMessages();

    } finally {

        setLoading(false);

        input.focus();
    }
});