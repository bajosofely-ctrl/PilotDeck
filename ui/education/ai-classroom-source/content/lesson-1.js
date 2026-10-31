export const lesson1 = {
    id: 'lesson-1',
    title: 'Lesson 1: Basic Prompt Structure',
    content: `
        <h1>Lesson 1: Basic Prompt Structure</h1>
        
        <p>A well-structured prompt is the foundation of effective AI interaction. Think of it like giving clear directions to a helpful assistant.</p>

        <h2>🏗️ Basic Prompt Components</h2>
        
        <p>Every good prompt should have these elements:</p>
        
        <div class="component-box">
            <h3>1. Task Description</h3>
            <p>Clearly state what you want the AI to do</p>
            <div class="example">
                <strong>Example:</strong> "Write a summary of the following article"
            </div>
        </div>
        
        <div class="component-box">
            <h3>2. Context (if needed)</h3>
            <p>Provide relevant background information</p>
            <div class="example">
                <strong>Example:</strong> "This is for a high school audience"
            </div>
        </div>
        
        <div class="component-box">
            <h3>3. Input Data</h3>
            <p>The content you want the AI to work with</p>
            <div class="example">
                <strong>Example:</strong> "Article: [your article text here]"
            </div>
        </div>
        
        <div class="component-box">
            <h3>4. Output Format</h3>
            <p>Specify how you want the response structured</p>
            <div class="example">
                <strong>Example:</strong> "Format as bullet points, max 5 points"
            </div>
        </div>

        <h2>📋 Template Structure</h2>
        
        <div class="code-block">
            <pre>
[TASK]: What you want done
[CONTEXT]: Relevant background (optional)
[INPUT]: Your data
[OUTPUT FORMAT]: How to structure the response
            </pre>
        </div>

        <h2>✅ Good vs. Poor Examples</h2>
        
        <div class="comparison">
            <div class="poor-example">
                <h4>❌ Poor Prompt</h4>
                <p>"Summarize this"</p>
                <small>Too vague, no context, no format specified</small>
            </div>
            
            <div class="good-example">
                <h4>✅ Good Prompt</h4>
                <p>"Write a 3-sentence summary of the following news article for a general audience. Focus on the main event, key people involved, and the outcome."</p>
                <small>Clear task, context, and format</small>
            </div>
        </div>

        <div class="alert alert-success">
            <p><strong>Key Takeaway:</strong> Structure helps Claude understand exactly what you need and how to deliver it effectively.</p>
        </div>

        <p>Ready to practice? Let's move on to the exercises where you'll apply these concepts!</p>
    `
}; 
