export const tutorialHowTo = {
    id: 'tutorial-how-to',
    title: 'Tutorial How-To',
    content: `
        <h1>Tutorial How-To</h1>
        
        <div class="alert alert-info">
            <p><strong>Welcome to Anthropic's Prompt Engineering Interactive Tutorial!</strong></p>
            <p>This tutorial requires an API key for interaction. If you don't have an API key, you can sign up for one via the <a href="https://console.anthropic.com/" target="_blank">Anthropic Console</a>.</p>
        </div>

        <h2>How to get started</h2>
        
        <ol>
            <li><strong>Set up your API key</strong>
                <ul>
                    <li>Click the "🔑 API Key" button in the top right corner</li>
                    <li>Enter your Anthropic API key</li>
                    <li>Your key is stored locally and only used for direct API calls</li>
                </ul>
            </li>
            <li><strong>Navigate through the tutorial</strong>
                <ul>
                    <li>Use the sidebar navigation to jump between sections</li>
                    <li>Or use the "Previous" and "Next" buttons at the bottom</li>
                </ul>
            </li>
            <li><strong>Complete the exercises</strong>
                <ul>
                    <li>Each lesson has accompanying exercises</li>
                    <li>Try different prompts and see Claude's responses</li>
                    <li>Learn from the examples and improve your technique</li>
                </ul>
            </li>
        </ol>

        <h2>Usage Notes & Tips 💡</h2>
        
        <p>This course uses <strong>Claude 3 Haiku</strong> with temperature 0. We will talk more about temperature later in the course. For now, it's enough to understand that these settings yield faster and more deterministic results. All prompt engineering techniques in this course also apply to other Claude models.</p>
        
        <div class="alert alert-success">
            <p><strong>Interactive Features:</strong></p>
            <ul>
                <li>When you arrive at the correct answer, the response area will turn <span style="color: #059669;">GREEN</span></li>
                <li>Your progress is automatically saved as you complete sections</li>
                <li>You can return to any section at any time</li>
            </ul>
        </div>

        <h2>What You'll Learn</h2>
        
        <p>By the end of this tutorial, you'll master:</p>
        <ul>
            <li>Basic prompt structure and formatting</li>
            <li>How to be clear and direct in your instructions</li>
            <li>Role prompting techniques</li>
            <li>Separating data from instructions</li>
            <li>Output formatting strategies</li>
            <li>Step-by-step reasoning (precognition)</li>
            <li>Few-shot prompting with examples</li>
            <li>Techniques to avoid hallucinations</li>
            <li>Complex prompt construction</li>
            <li>Advanced topics like chaining and function calling</li>
        </ul>
    `
}; 
