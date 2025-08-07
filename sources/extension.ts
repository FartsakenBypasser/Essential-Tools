import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface ClaudeMessage {
    role: 'user' | 'assistant';
    content: string | Array<{
        type: 'text' | 'image';
        text?: string;
        source?: {
            type: 'base64';
            media_type: string;
            data: string;
        };
    }>;
}

interface AttachedFile {
    name: string;
    content: string;
    language?: string;
    path?: string;
}

interface AttachedImage {
    name: string;
    data: string;
    mediaType: string;
}

interface ModelInfo {
    id: string;
    name: string;
    isPaid: boolean;
}

class ClaudeAPI {
    private apiKey: string;
    private model: string;
    private maxTokens: number;
    private availableModels: ModelInfo[] = [
        // Free models
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', isPaid: false },
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', isPaid: false },
        
        // Paid models - Claude 4 family (latest)
        { id: 'claude-opus-4.1-20250805', name: 'Claude Opus 4.1', isPaid: true },
        { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', isPaid: true },
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', isPaid: true },
        
        // Paid models - Claude 3.7 and 3.5
        { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', isPaid: true },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', isPaid: true },
        
        // Paid models - Claude 3 family
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', isPaid: true },
        { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', isPaid: true }
    ];

    constructor() {
        this.updateConfig();
    }

    updateConfig() {
        const config = vscode.workspace.getConfiguration('claude-assistant');
        this.apiKey = config.get('apiKey', '');
        this.model = config.get('model', 'claude-3-5-haiku-20241022');
        this.maxTokens = config.get('maxTokens', 200000);
    }

    async checkApiKeyAccess(): Promise<ModelInfo[]> {
        if (!this.apiKey) {
            return this.availableModels.filter(m => !m.isPaid);
        }

        try {
            // Test API key with a simple request
            await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: 'claude-3-5-haiku-20241022',
                    max_tokens: 10,
                    messages: [{ role: 'user', content: 'Hi' }]
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': this.apiKey,
                        'anthropic-version': '2023-06-01'
                    }
                }
            );
            
            // If successful, return all models (assuming paid access)
            return this.availableModels;
        } catch (error: any) {
            if (error.response?.status === 401) {
                // Invalid API key, return only free models
                return this.availableModels.filter(m => !m.isPaid);
            }
            // For other errors, assume free access
            return this.availableModels.filter(m => !m.isPaid);
        }
    }

    getAvailableModels(): ModelInfo[] {
        return this.availableModels;
    }

    async sendMessage(messages: ClaudeMessage[], selectedModel?: string): Promise<string> {
        if (!this.apiKey) {
            throw new Error('API key not configured. Please set your Anthropic API key.');
        }

        const modelToUse = selectedModel || this.model;

        try {
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: modelToUse,
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
                throw new Error('Invalid API key. Please check your Anthropic API key.');
            } else if (error.response?.status === 429) {
                throw new Error('Rate limit exceeded. Please try again later.');
            } else if (error.response?.status === 403) {
                throw new Error('Access denied. You may need a paid plan to use this model.');
            } else {
                throw new Error(`API Error: ${error.message}`);
            }
        }
    }
}

class ClaudeCodeAssistant {
    private claudeAPI: ClaudeAPI;
    private outputChannel: vscode.OutputChannel;
    private attachedFiles: AttachedFile[] = [];
    private attachedImages: AttachedImage[] = [];
    private chatPanel: vscode.WebviewPanel | undefined;
    private currentActiveFile: string | undefined;

    constructor() {
        this.claudeAPI = new ClaudeAPI();
        this.outputChannel = vscode.window.createOutputChannel('Claude Assistant');
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        // Watch for active editor changes
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            const config = vscode.workspace.getConfiguration('claude-assistant');
            const autoAttach = config.get('autoAttachFile', true);
            
            if (autoAttach && editor && editor.document.uri.scheme === 'file') {
                this.attachCurrentFile(editor);
            }
        });
    }

    private attachCurrentFile(editor: vscode.TextEditor) {
        const filePath = editor.document.fileName;
        const fileName = path.basename(filePath);
        const language = editor.document.languageId;
        const content = editor.document.getText();

        // Don't attach if it's the same file
        if (this.currentActiveFile === filePath) {
            return;
        }

        // Remove previous auto-attached file
        this.attachedFiles = this.attachedFiles.filter(f => f.path !== this.currentActiveFile);
        
        // Add new file
        this.attachedFiles.push({
            name: fileName,
            content: content,
            language: language,
            path: filePath
        });

        this.currentActiveFile = filePath;
        
        // Update chat UI if open
        if (this.chatPanel) {
            this.updateChatAttachments();
        }
    }

    private updateChatAttachments() {
        if (this.chatPanel) {
            this.chatPanel.webview.postMessage({
                command: 'updateAttachments',
                files: this.attachedFiles.map(f => ({ name: f.name, path: f.path })),
                images: this.attachedImages.map(i => ({ name: i.name }))
            });
        }
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

    async openApiKeyChanger() {
        const currentKey = vscode.workspace.getConfiguration('claude-assistant').get('apiKey', '');
        const maskedKey = currentKey ? `${currentKey.substring(0, 8)}...${currentKey.substring(currentKey.length - 4)}` : 'Not set';
        
        const newKey = await vscode.window.showInputBox({
            prompt: 'Enter your Anthropic API key',
            value: '',
            password: true,
            placeHolder: `Current: ${maskedKey}`
        });

        if (newKey !== undefined) {
            await vscode.workspace.getConfiguration('claude-assistant').update('apiKey', newKey, vscode.ConfigurationTarget.Global);
            this.claudeAPI.updateConfig();
            vscode.window.showInformationMessage('API key updated successfully');
            
            // Update available models in chat if open
            if (this.chatPanel) {
                const models = await this.claudeAPI.checkApiKeyAccess();
                this.chatPanel.webview.postMessage({
                    command: 'updateModels',
                    models: models
                });
            }
        }
    }

    async openChat() {
        if (this.chatPanel) {
            this.chatPanel.reveal();
            return;
        }

        this.chatPanel = vscode.window.createWebviewPanel(
            'claude-chat',
            'Claude Chat',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        const models = await this.claudeAPI.checkApiKeyAccess();
        this.chatPanel.webview.html = await this.getChatHTML(models);
        
        this.chatPanel.onDidDispose(() => {
            this.chatPanel = undefined;
        });

        // Send initial attachments
        this.updateChatAttachments();
        
        this.chatPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'sendMessage':
                    await this.handleChatMessage(message.text, message.model);
                    break;
                case 'attachFile':
                    await this.handleFileAttachment();
                    break;
                case 'attachImage':
                    await this.handleImageAttachment();
                    break;
                case 'removeFile':
                    this.removeAttachedFile(message.path);
                    break;
                case 'removeImage':
                    this.removeAttachedImage(message.name);
                    break;
                case 'openApiKeyChanger':
                    await this.openApiKeyChanger();
                    break;
                case 'refreshModels':
                    const updatedModels = await this.claudeAPI.checkApiKeyAccess();
                    this.chatPanel?.webview.postMessage({
                        command: 'updateModels',
                        models: updatedModels
                    });
                    break;
            }
        });
    }

    private async handleChatMessage(text: string, selectedModel: string) {
        try {
            let content: string | Array<any> = text;
            
            // Add attached files context
            if (this.attachedFiles.length > 0) {
                let fileContext = '\n\n**Attached Files:**\n';
                for (const file of this.attachedFiles) {
                    fileContext += `\n**${file.name}** (${file.language}):\n\`\`\`${file.language}\n${file.content}\n\`\`\`\n`;
                }
                text += fileContext;
            }

            // Add images if any
            if (this.attachedImages.length > 0) {
                content = [
                    { type: 'text', text: text },
                    ...this.attachedImages.map(img => ({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: img.mediaType,
                            data: img.data
                        }
                    }))
                ];
            } else {
                content = text;
            }

            const messages: ClaudeMessage[] = [{
                role: 'user',
                content: content
            }];

            const response = await this.claudeAPI.sendMessage(messages, selectedModel);
            this.chatPanel?.webview.postMessage({
                command: 'receiveMessage',
                text: response
            });
        } catch (error: any) {
            this.chatPanel?.webview.postMessage({
                command: 'receiveError',
                text: error.message
            });
        }
    }

    private async handleFileAttachment() {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Attach File',
            filters: {
                'Code Files': ['js', 'ts', 'py', 'java', 'cpp', 'c', 'cs', 'php', 'rb', 'go', 'rs', 'swift'],
                'Text Files': ['txt', 'md', 'json', 'xml', 'yaml', 'yml', 'csv'],
                'All Files': ['*']
            }
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            try {
                const filePath = fileUri[0].fsPath;
                const fileName = path.basename(filePath);
                const content = fs.readFileSync(filePath, 'utf-8');
                const language = this.getLanguageFromExtension(path.extname(fileName));

                // Check if file already attached
                if (this.attachedFiles.find(f => f.path === filePath)) {
                    vscode.window.showWarningMessage('File already attached');
                    return;
                }

                this.attachedFiles.push({
                    name: fileName,
                    content: content,
                    language: language,
                    path: filePath
                });

                this.updateChatAttachments();
            } catch (error) {
                vscode.window.showErrorMessage('Failed to read file');
            }
        }
    }

    private async handleImageAttachment() {
        const config = vscode.workspace.getConfiguration('claude-assistant');
        const maxImages = config.get('maxImages', 3);

        if (this.attachedImages.length >= maxImages) {
            vscode.window.showWarningMessage(`Maximum ${maxImages} images allowed`);
            return;
        }

        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Attach Image',
            filters: {
                'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp']
            }
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            try {
                const filePath = fileUri[0].fsPath;
                const fileName = path.basename(filePath);
                const extension = path.extname(fileName).toLowerCase();
                const mediaType = this.getMediaType(extension);
                const data = fs.readFileSync(filePath).toString('base64');

                this.attachedImages.push({
                    name: fileName,
                    data: data,
                    mediaType: mediaType
                });

                this.updateChatAttachments();
            } catch (error) {
                vscode.window.showErrorMessage('Failed to read image');
            }
        }
    }

    private removeAttachedFile(filePath: string) {
        this.attachedFiles = this.attachedFiles.filter(f => f.path !== filePath);
        if (this.currentActiveFile === filePath) {
            this.currentActiveFile = undefined;
        }
        this.updateChatAttachments();
    }

    private removeAttachedImage(imageName: string) {
        this.attachedImages = this.attachedImages.filter(i => i.name !== imageName);
        this.updateChatAttachments();
    }

    private getLanguageFromExtension(ext: string): string {
        const langMap: { [key: string]: string } = {
            '.js': 'javascript',
            '.ts': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.cs': 'csharp',
            '.php': 'php',
            '.rb': 'ruby',
            '.go': 'go',
            '.rs': 'rust',
            '.swift': 'swift',
            '.json': 'json',
            '.xml': 'xml',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.md': 'markdown'
        };
        return langMap[ext] || 'text';
    }

    private getMediaType(ext: string): string {
        const mediaMap: { [key: string]: string } = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        };
        return mediaMap[ext] || 'image/jpeg';
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
        return text
            .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>')
            .replace(/$/, '</p>');
    }

    private async getChatHTML(models: ModelInfo[]): Promise<string> {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Claude Chat</title>
                <style>
                    * { box-sizing: border-box; }
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                        margin: 0; padding: 20px; height: 100vh; display: flex; flex-direction: column;
                        background: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                    }
                    
                    .header {
                        display: flex;
                        gap: 10px;
                        align-items: center;
                        margin-bottom: 15px;
                        padding-bottom: 15px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    
                    .model-selector {
                        flex: 1;
                        padding: 8px;
                        border: 1px solid var(--vscode-input-border);
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 4px;
                    }
                    
                    .api-key-btn, .attach-btn, .refresh-btn {
                        padding: 8px 12px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                    }
                    
                    .api-key-btn:hover, .attach-btn:hover, .refresh-btn:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    
                    .attachments {
                        margin-bottom: 15px;
                        padding: 10px;
                        background: var(--vscode-editor-inactiveSelectionBackground);
                        border-radius: 4px;
                        display: none;
                    }
                    
                    .attachments.visible { display: block; }
                    
                    .attachment-item {
                        display: inline-flex;
                        align-items: center;
                        gap: 5px;
                        margin: 2px;
                        padding: 4px 8px;
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        border-radius: 12px;
                        font-size: 12px;
                    }
                    
                    .remove-btn {
                        background: none;
                        border: none;
                        color: inherit;
                        cursor: pointer;
                        padding: 0;
                        margin-left: 4px;
                        font-weight: bold;
                    }
                    
                    #chat-container { 
                        flex: 1; 
                        overflow-y: auto; 
                        border: 1px solid var(--vscode-panel-border); 
                        padding: 10px; 
                        margin-bottom: 10px;
                        background: var(--vscode-editor-background);
                    }
                    
                    #input-container { 
                        display: flex; 
                        gap: 10px; 
                    }
                    
                    #message-input { 
                        flex: 1; 
                        padding: 10px; 
                        border: 1px solid var(--vscode-input-border);
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 4px; 
                    }
                    
                    #send-button { 
                        padding: 10px 20px; 
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none; 
                        border-radius: 4px; 
                        cursor: pointer; 
                    }
                    
                    #send-button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    
                    .message { 
                        margin: 10px 0; 
                        padding: 10px; 
                        border-radius: 5px; 
                    }
                    
                    .user-message { 
                        background: var(--vscode-textBlockQuote-background);
                        border-left: 4px solid var(--vscode-textLink-foreground);
                    }
                    
                    .assistant-message { 
                        background: var(--vscode-editor-inactiveSelectionBackground);
                    }
                    
                    .error-message { 
                        background: var(--vscode-inputValidation-errorBackground);
                        color: var(--vscode-inputValidation-errorForeground);
                    }
                    
                    .model-indicator {
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 5px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <select class="model-selector" id="model-select">
                        ${models.map(model => 
                            `<option value="${model.id}">${model.name}${model.isPaid ? ' (Paid)' : ' (Free)'}</option>`
                        ).join('')}
                    </select>
                    <button class="refresh-btn" id="refresh-models">🔄</button>
                    <button class="api-key-btn" id="api-key-btn">🔑 API Key</button>
                    <button class="attach-btn" id="attach-file">📎 File</button>
                    <button class="attach-btn" id="attach-image">🖼️ Image</button>
                </div>
                
                <div class="attachments" id="attachments">
                    <strong>Attachments:</strong>
                    <div id="attached-files"></div>
                    <div id="attached-images"></div>
                </div>
                
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
                    const modelSelect = document.getElementById('model-select');
                    const apiKeyBtn = document.getElementById('api-key-btn');
                    const attachFileBtn = document.getElementById('attach-file');
                    const attachImageBtn = document.getElementById('attach-image');
                    const refreshBtn = document.getElementById('refresh-models');
                    const attachmentsDiv = document.getElementById('attachments');
                    const attachedFilesDiv = document.getElementById('attached-files');
                    const attachedImagesDiv = document.getElementById('attached-images');

                    let attachedFiles = [];
                    let attachedImages = [];

                    function addMessage(content, isUser = false, isError = false, model = null) {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'message ' + (isError ? 'error-message' : isUser ? 'user-message' : 'assistant-message');
                        
                        if (model && !isUser && !isError) {
                            const modelIndicator = document.createElement('div');
                            modelIndicator.className = 'model-indicator';
                            modelIndicator.textContent = \`Model: \${model}\`;
                            messageDiv.appendChild(modelIndicator);
                        }
                        
                        const contentDiv = document.createElement('div');
                        contentDiv.innerHTML = formatMessage(content);
                        messageDiv.appendChild(contentDiv);
                        
                        chatContainer.appendChild(messageDiv);
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }

                    function formatMessage(text) {
                        return text
                            .replace(/```(\\w+)?\\n([\\s\\S]*?)```/g, '<pre style="background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 4px; overflow-x: auto;"><code>$2</code></pre>')
                            .replace(/\`([^\`]+)\`/g, '<code style="background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px;">$1</code>')
                            .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
                            .replace(/\\*(.*?)\\*/g, '<em>$1</em>')
                            .replace(/\\n\\n/g, '</p><p>')
                            .replace(/\\n/g, '<br>')
                            .replace(/^/, '<p>')
                            .replace(/$/, '</p>');
                    }

                    function updateAttachments() {
                        attachedFilesDiv.innerHTML = '';
                        attachedImagesDiv.innerHTML = '';

                        attachedFiles.forEach(file => {
                            const fileItem = document.createElement('div');
                            fileItem.className = 'attachment-item';
                            fileItem.innerHTML = \`
                                📄 \${file.name}
                                <button class="remove-btn" onclick="removeFile('\${file.path}')">×</button>
                            \`;
                            attachedFilesDiv.appendChild(fileItem);
                        });

                        attachedImages.forEach(image => {
                            const imageItem = document.createElement('div');
                            imageItem.className = 'attachment-item';
                            imageItem.innerHTML = \`
                                🖼️ \${image.name}
                                <button class="remove-btn" onclick="removeImage('\${image.name}')">×</button>
                            \`;
                            attachedImagesDiv.appendChild(imageItem);
                        });

                        const hasAttachments = attachedFiles.length > 0 || attachedImages.length > 0;
                        attachmentsDiv.className = hasAttachments ? 'attachments visible' : 'attachments';
                    }

                    function removeFile(path) {
                        vscode.postMessage({
                            command: 'removeFile',
                            path: path
                        });
                    }

                    function removeImage(name) {
                        vscode.postMessage({
                            command: 'removeImage',
                            name: name
                        });
                    }

                    function sendMessage() {
                        const message = messageInput.value.trim();
                        if (!message) return;

                        const selectedModel = modelSelect.value;
                        const modelName = modelSelect.options[modelSelect.selectedIndex].text;
                        
                        addMessage(message, true);
                        messageInput.value = '';
                        
                        vscode.postMessage({
                            command: 'sendMessage',
                            text: message,
                            model: selectedModel
                        });
                    }

                    // Event listeners
                    sendButton.addEventListener('click', sendMessage);
                    messageInput.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    });

                    apiKeyBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'openApiKeyChanger' });
                    });

                    attachFileBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'attachFile' });
                    });

                    attachImageBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'attachImage' });
                    });

                    refreshBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'refreshModels' });
                    });

                    // Handle messages from extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'receiveMessage':
                                const selectedModel = modelSelect.value;
                                const modelName = modelSelect.options[modelSelect.selectedIndex].text;
                                addMessage(message.text, false, false, modelName);
                                break;
                            case 'receiveError':
                                addMessage(message.text, false, true);
                                break;
                            case 'updateAttachments':
                                attachedFiles = message.files || [];
                                attachedImages = message.images || [];
                                updateAttachments();
                                break;
                            case 'updateModels':
                                const currentValue = modelSelect.value;
                                modelSelect.innerHTML = '';
                                message.models.forEach(model => {
                                    const option = document.createElement('option');
                                    option.value = model.id;
                                    option.textContent = \`\${model.name}\${model.isPaid ? ' (Paid)' : ' (Free)'}\`;
                                    modelSelect.appendChild(option);
                                });
                                // Try to maintain selection
                                if (Array.from(modelSelect.options).some(opt => opt.value === currentValue)) {
                                    modelSelect.value = currentValue;
                                }
                                break;
                        }
                    });

                    // Initialize
                    updateAttachments();
                </script>
            </body>
            </html>
        `;
    }
}
