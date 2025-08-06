import * as vscode from 'vscode';
import axios from 'axios';

interface ClaudeMessage {
    role: 'user' | 'assistant';
    content: string;
}

class ClaudeAPI {
    private apiKey: string;
    private model: string;
    private maxTokens: number;

    constructor() {
        this.updateConfig();
    }

    updateConfig() {
        const config = vscode.workspace.getConfiguration('claude-assistant');
        this.apiKey = config.get('apiKey', '');
        this.model = config.get('model', 'claude-sonnet-4-20250514');
        this.maxTokens = config.get('maxTokens', 4000);
    }

    async sendMessage(messages: ClaudeMessage[]): Promise<string> {
        if (!this.apiKey) {
            throw new Error('API key not configured. Please set your Anthropic API key in settings.');
        }

        try {
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: this.model,
                    max_tokens: this.maxTokens,
                    messages: messages
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': this.apiKey,
                        'anthropic-version': '2023-06-01'
                    }
                }
            );

            return response.data.content[0].text;
        } catch (error: any) {
            if (error.response?.status === 401) {
                throw new Error('Invalid API key. Please check your Anthropic API key in settings.');
            } else if (error.response?.status === 429) {
                throw new Error('Rate limit exceeded. Please try again later.');
            } else {
                throw new Error(`API Error: ${error.message}`);
            }
        }
    }
}

class ClaudeCodeAssistant {
    private claudeAPI: ClaudeAPI;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.claudeAPI = new ClaudeAPI();
        this.outputChannel = vscode.window.createOutputChannel('Claude Assistant');
    }

    async explainCode() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        
        if (!selectedText) {
            vscode.window.showErrorMessage('No code selected');
            return;
        }

        const language = editor.document.languageId;
        
        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Claude is analyzing your code...",
                cancellable: false
            }, async () => {
                const messages: ClaudeMessage[] = [{
                    role: 'user',
                    content: `Please explain this ${language} code:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``
                }];

                const response = await this.claudeAPI.sendMessage(messages);
                this.showResponse('Code Explanation', response);
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(error.message);
        }
    }

    async optimizeCode() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        
        if (!selectedText) {
            vscode.window.showErrorMessage('No code selected');
            return;
        }

        const language = editor.document.languageId;
        
        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Claude is optimizing your code...",
                cancellable: false
            }, async () => {
                const messages: ClaudeMessage[] = [{
                    role: 'user',
                    content: `Please optimize this ${language} code for better performance, readability, and best practices:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``
                }];

                const response = await this.claudeAPI.sendMessage(messages);
                this.showResponse('Code Optimization', response);
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(error.message);
        }
    }

    async addComments() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        
        if (!selectedText) {
            vscode.window.showErrorMessage('No code selected');
            return;
        }

        const language = editor.document.languageId;
        
        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Claude is adding comments...",
                cancellable: false
            }, async () => {
                const messages: ClaudeMessage[] = [{
                    role: 'user',
                    content: `Please add helpful comments to this ${language} code to explain what it does:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``
                }];

                const response = await this.claudeAPI.sendMessage(messages);
                this.showResponse('Commented Code', response);
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(error.message);
        }
    }

    async debugCode() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found');
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        
        if (!selectedText) {
            vscode.window.showErrorMessage('No code selected');
            return;
        }

        const language = editor.document.languageId;
        
        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Claude is analyzing for bugs...",
                cancellable: false
            }, async () => {
                const messages: ClaudeMessage[] = [{
                    role: 'user',
                    content: `Please analyze this ${language} code for potential bugs, issues, or improvements:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``
                }];

                const response = await this.claudeAPI.sendMessage(messages);
                this.showResponse('Debug Analysis', response);
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(error.message);
        }
    }

    async openChat() {
        const panel = vscode.window.createWebviewPanel(
            'claude-chat',
            'Claude Chat',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.getChatHTML();
        
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'sendMessage') {
                try {
                    const messages: ClaudeMessage[] = [{
                        role: 'user',
                        content: message.text
                    }];

                    const response = await this.claudeAPI.sendMessage(messages);
                    panel.webview.postMessage({
                        command: 'receiveMessage',
                        text: response
                    });
                } catch (error: any) {
                    panel.webview.postMessage({
                        command: 'receiveError',
                        text: error.message
                    });
                }
            }
        });
    }

    private showResponse(title: string, content: string) {
        const panel = vscode.window.createWebviewPanel(
            'claude-response',
            title,
            vscode.ViewColumn.Two,
            {}
        );

        panel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${title}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; line-height: 1.6; }
                    pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
                    code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
                </style>
            </head>
            <body>
                <h1>${title}</h1>
                <div>${this.formatResponse(content)}</div>
            </body>
            </html>
        `;
    }

    private formatResponse(text: string): string {
        // Basic markdown-like formatting
        return text
            .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>')
            .replace(/$/, '</p>');
    }

    private getChatHTML(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Claude Chat</title>
                <style>
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                        margin: 0; padding: 20px; height: 100vh; display: flex; flex-direction: column;
                    }
                    #chat-container { flex: 1; overflow-y: auto; border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; }
                    #input-container { display: flex; gap: 10px; }
                    #message-input { flex: 1; padding: 10px; border: 1px solid #ccc; border-radius: 4px; }
                    #send-button { padding: 10px 20px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer; }
                    .message { margin: 10px 0; padding: 10px; border-radius: 5px; }
                    .user-message { background: #e3f2fd; }
                    .assistant-message { background: #f5f5f5; }
                    .error-message { background: #ffebee; color: #c62828; }
                </style>
            </head>
            <body>
                <div id="chat-container"></div>
                <div id="input-container">
                    <input type="text" id="message-input" placeholder="Ask Claude anything..." />
                    <button id="send-button">Send</button>
                </div>
                
                <script>
                    const vscode = acquireVsCodeApi();
                    const chatContainer = document.getElementById('chat-container');
                    const messageInput = document.getElementById('message-input');
                    const sendButton = document.getElementById('send-button');

                    function addMessage(content, isUser = false, isError = false) {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'message ' + (isError ? 'error-message' : isUser ? 'user-message' : 'assistant-message');
                        messageDiv.textContent = content;
                        chatContainer.appendChild(messageDiv);
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }

                    function sendMessage() {
                        const message = messageInput.value.trim();
                        if (!message) return;

                        addMessage(message, true);
                        messageInput.value = '';
                        
                        vscode.postMessage({
                            command: 'sendMessage',
                            text: message
                        });
                    }

                    sendButton.addEventListener('click', sendMessage);
                    messageInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') sendMessage();
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.command === 'receiveMessage') {
                            addMessage(message.text);
                        } else if (message.command === 'receiveError') {
                            addMessage(message.text, false, true);
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}

export function activate(context: vscode.ExtensionContext) {
    const assistant = new ClaudeCodeAssistant();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('claude-assistant.explain', () => assistant.explainCode()),
        vscode.commands.registerCommand('claude-assistant.optimize', () => assistant.optimizeCode()),
        vscode.commands.registerCommand('claude-assistant.comment', () => assistant.addComments()),
        vscode.commands.registerCommand('claude-assistant.debug', () => assistant.debugCode()),
        vscode.commands.registerCommand('claude-assistant.chat', () => assistant.openChat())
    );

    // Update API configuration when settings change
    vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('claude-assistant')) {
            assistant['claudeAPI'].updateConfig();
        }
    });
}

export function deactivate() {}
