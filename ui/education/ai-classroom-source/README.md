# 🚀 Anthropic's Prompt Engineering Tutorial (Web Version)

A sleek, interactive web version of [Anthropic's Prompt Engineering Tutorial](https://docs.google.com/spreadsheets/d/19jzLgRruG9kjUQNKtCg1ZjdD6l6weA6qRXG5zLIAhC8/edit?gid=150872633#gid=150872633) for those who prefer clicking through lessons instead of scrolling through spreadsheet cells.

## ✨ What's This?

This project transforms Anthropic's comprehensive prompt engineering spreadsheet into a modern, interactive web experience. Same great content, just with better vibes and actual buttons you can click.

**Original Tutorial**: [Google Sheets](https://docs.google.com/spreadsheets/d/19jzLgRruG9kjUQNKtCg1ZjdD6l6weA6qRXG5zLIAhC8/edit?gid=150872633#gid=150872633)  
**Source Code**: [GitHub](https://github.com/anthropics/prompt-eng-interactive-tutorial)

## 🎯 Features

- **Interactive Exercises**: Practice prompts with real Claude API integration
- **Progress Tracking**: See your journey through the lessons
- **Mobile Friendly**: Works great on phones and tablets
- **Modular Content**: Each lesson lives in its own file for easy updates

## 🛠️ Getting Started

1. Clone this repo
2. Open `index.html` in your browser (or serve it locally)
3. Add your Anthropic API key when prompted
4. Start learning!

```bash
# Quick local server
python3 -m http.server 8000
# Then visit http://localhost:8000
```

## 🤝 Contributing

This was totally vibe-coded and there's definitely room for improvement! Feel free to:

- Add more lessons from the original spreadsheet
- Improve the UI/UX
- Fix bugs you stumble upon
- Add new interactive features
- Make it even more beautiful

Just fork, hack, and send a PR. No formal process needed – if it makes the tutorial better, it's welcome!

## 📚 Content Structure

```
content/
├── tutorial-how-to.js    # Setup & getting started
├── intro.js              # Course overview
├── lesson-*.js           # Individual lessons
├── exercises-*.js        # Interactive practice
└── content-loader.js     # Ties it all together
```

## 🙏 Credits

- **Content**: Anthropic's amazing prompt engineering team
- **Web Version**: Lovingly vibe-coded using Cursor AI for better accessibility
- **You**: For making prompt engineering more awesome
