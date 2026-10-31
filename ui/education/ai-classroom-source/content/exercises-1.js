export const exercises1 = {
    id: 'exercises-1',
    title: 'Exercises 1: Basic Prompt Structure',
    content: `
        <h1>Exercises 1: Basic Prompt Structure</h1>
        
        <p>Now let's practice what you've learned! Try these exercises to master basic prompt structure.</p>

        <div class="exercise-container">
            <h2>🎯 Exercise 1.1: Structure a Basic Prompt</h2>
            
            <p><strong>Scenario:</strong> You want Claude to write a product description for a bluetooth speaker.</p>
            
            <p><strong>Your task:</strong> Write a well-structured prompt that includes all the key components we discussed.</p>
            
            <div class="exercise-input">
                <label for="exercise-1-1">Your prompt:</label>
                <textarea id="exercise-1-1" rows="6" placeholder="Write your structured prompt here..."></textarea>
                <button onclick="runExercise('1-1')" class="btn btn-primary">Test Your Prompt</button>
            </div>
            
            <div id="result-1-1" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Hint</summary>
                    <p>Remember the 4 components: Task description, Context, Input data, and Output format. For this exercise, think about what information you'd need to include about the speaker and how you want the description formatted.</p>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 1.2: Compare Prompt Structures</h2>
            
            <p>Let's see the difference structure makes. Try both prompts below and compare the results:</p>
            
            <div class="comparison-exercise">
                <div class="prompt-option">
                    <h4>Prompt A (Unstructured)</h4>
                    <div class="code-block">
                        <pre>Write about dogs</pre>
                    </div>
                    <button onclick="comparePrompts('A', 'Write about dogs')" class="btn btn-secondary">Try Prompt A</button>
                </div>
                
                <div class="prompt-option">
                    <h4>Prompt B (Structured)</h4>
                    <div class="code-block">
                        <pre>Write a 200-word informative article about dog care for new pet owners. Include sections on feeding, exercise, and basic training. Use a friendly, helpful tone.</pre>
                    </div>
                    <button onclick="comparePrompts('B', 'Write a 200-word informative article about dog care for new pet owners. Include sections on feeding, exercise, and basic training. Use a friendly, helpful tone.')" class="btn btn-secondary">Try Prompt B</button>
                </div>
            </div>
            
            <div id="comparison-results" class="comparison-results"></div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 1.3: Fix the Prompt</h2>
            
            <p>Here's a poorly structured prompt. Can you improve it?</p>
            
            <div class="poor-prompt">
                <h4>❌ Poor Prompt:</h4>
                <p>"Make it better and more professional"</p>
            </div>
            
            <p><strong>Context:</strong> The user wants to improve this email: "hey can u send me the report thx"</p>
            
            <div class="exercise-input">
                <label for="exercise-1-3">Your improved prompt:</label>
                <textarea id="exercise-1-3" rows="6" placeholder="Rewrite the prompt with proper structure..."></textarea>
                <button onclick="runExercise('1-3')" class="btn btn-primary">Test Your Improved Prompt</button>
            </div>
            
            <div id="result-1-3" class="exercise-result"></div>
            
            <div class="solution-box">
                <details>
                    <summary>✅ Sample Solution</summary>
                    <div class="code-block">
                        <pre>Please rewrite the following casual email to make it more professional and polite, suitable for workplace communication:

Email to rewrite: "hey can u send me the report thx"

Requirements:
- Use proper greeting and closing
- Be specific about which report
- Include a polite request
- Maintain professional tone</pre>
                    </div>
                </details>
            </div>
        </div>

        <div class="alert alert-success">
            <p><strong>Great work!</strong> You're getting the hang of prompt structure. Clear structure leads to better, more predictable results from Claude.</p>
        </div>
    `
};

export const exerciseHints = {
    '1-1': {
        hint: "Try including: 1) Clear task (write product description), 2) Context (for what audience/purpose), 3) Product details, 4) Desired format/length",
        solution: `Write a compelling product description for an online store listing:

Product: Bluetooth Wireless Speaker
- 20W output power
- 12-hour battery life  
- Waterproof (IPX7 rating)
- Available in black, blue, red
- Price: $79.99

Format: 2-3 paragraphs, highlight key benefits, include call-to-action, casual but persuasive tone for general consumers.`
    },
    '1-3': {
        hint: "The original prompt is too vague. What specific task needs to be done? What's the input? What should the output look like?",
        solution: `Please rewrite the following casual email to make it more professional and polite, suitable for workplace communication:

Email to rewrite: "hey can u send me the report thx"

Requirements:
- Use proper greeting and closing
- Be specific about which report  
- Include a polite request
- Maintain professional tone`
    }
}; 
