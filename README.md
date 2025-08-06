# Claude Code Assistant

A VS Code extension that integrates Claude AI to provide intelligent code assistance directly in your editor.

## Features

- **Explain Code**: Get detailed explanations of selected code snippets
- **Optimize Code**: Improve code performance, readability, and best practices
- **Add Comments**: Automatically generate helpful comments for your code
- **Debug Helper**: Analyze code for potential bugs and issues
- **Chat Interface**: Interactive chat with Claude for general coding questions

## Installation

1. Clone or download this extension
2. Open the folder in VS Code
3. Run `npm install` to install dependencies
4. Press `F5` to launch a new Extension Development Host window
5. Configure your API key (see Configuration section)

## Configuration

1. Open VS Code settings (Ctrl/Cmd + ,)
2. Search for "Claude Assistant"
3. Set your Anthropic API key in the `claude-assistant.apiKey` setting

### Available Settings

- `claude-assistant.apiKey`: Your Anthropic API key (required)
- `claude-assistant.model`: Claude model to use (default: claude-sonnet-4-20250514)
- `claude-assistant.maxTokens`: Maximum tokens for responses (default: 4000)

## Usage

### Context Menu Commands
1. Select code in the editor
2. Right-click to open context menu
3. Choose from Claude options:
   - "Explain Code"
   - "Optimize Code" 
   - "Add Comments"
   - "Help Debug"

### Command Palette
- Open Command Palette (Ctrl/Cmd + Shift + P)
- Type "Claude" to see available commands
- Select "Claude: Chat with Claude" for interactive chat

### Keyboard Shortcuts
You can add custom keyboard shortcuts by going to:
1. File → Preferences → Keyboard Shortcuts
2. Search for "Claude"
3. Add your preferred key bindings

## Getting Your API Key

1. Visit [Anthropic's website](https://console.anthropic.com/)
2. Sign up for an account
3. Navigate to the API keys section
4. Generate a new API key
5. Copy and paste it into the VS Code settings

## Requirements

- VS Code version 1.74.0 or higher
- An Anthropic API key
- Internet connection for API calls

Feel free to submit issues and enhancement requests through [My Discord](https://discord.gg/ExuT3N5W)
