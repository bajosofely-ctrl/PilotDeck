export const lesson2 = {
    id: 'lesson-2',
    title: 'Lesson 2: Being Clear and Direct',
    content: `
        <h1>Lesson 2: Being Clear and Direct</h1>
        
        <p>One of the most important principles in prompt engineering is clarity. Claude performs best when instructions are specific, unambiguous, and direct.</p>

        <h2>🎯 The Power of Specificity</h2>
        
        <p>Vague instructions lead to unpredictable results. Being specific helps Claude understand exactly what you want.</p>

        <div class="comparison">
            <div class="poor-example">
                <h4>❌ Vague</h4>
                <p>"Make this better"</p>
                <small>What does "better" mean? Better how?</small>
            </div>
            
            <div class="good-example">
                <h4>✅ Specific</h4>
                <p>"Improve the readability of this text by shortening sentences, using simpler vocabulary, and adding paragraph breaks for better flow."</p>
                <small>Clear, actionable instructions</small>
            </div>
        </div>

        <h2>📝 Key Principles for Clarity</h2>

        <div class="component-box">
            <h3>1. Use Active Voice</h3>
            <p>Active voice makes instructions clearer and more direct.</p>
            <div class="example">
                <strong>Instead of:</strong> "The report should be written"<br>
                <strong>Try:</strong> "Write a report"
            </div>
        </div>

        <div class="component-box">
            <h3>2. Be Specific About Scope</h3>
            <p>Define boundaries and limitations clearly.</p>
            <div class="example">
                <strong>Instead of:</strong> "Explain machine learning"<br>
                <strong>Try:</strong> "Explain machine learning in 3 paragraphs, focusing on supervised vs unsupervised learning for beginners"
            </div>
        </div>

        <div class="component-box">
            <h3>3. Use Concrete Examples</h3>
            <p>When possible, provide specific examples of what you want.</p>
            <div class="example">
                <strong>Instead of:</strong> "Write in a professional tone"<br>
                <strong>Try:</strong> "Write in a professional tone similar to a business proposal, avoiding casual language and slang"
            </div>
        </div>

        <div class="component-box">
            <h3>4. Specify Output Format</h3>
            <p>Tell Claude exactly how to structure the response.</p>
            <div class="example">
                <strong>Instead of:</strong> "List the benefits"<br>
                <strong>Try:</strong> "List 5 benefits in bullet points, with each point being 1-2 sentences"
            </div>
        </div>

        <h2>🔍 Common Clarity Issues</h2>

        <div class="alert alert-warning">
            <h3>Ambiguous Pronouns</h3>
            <p><strong>Problem:</strong> "Analyze it and explain how it works"</p>
            <p><strong>Solution:</strong> "Analyze the customer feedback data and explain how the sentiment analysis algorithm works"</p>
        </div>

        <div class="alert alert-warning">
            <h3>Undefined Terms</h3>
            <p><strong>Problem:</strong> "Make it more engaging"</p>
            <p><strong>Solution:</strong> "Make the presentation more engaging by adding interactive elements, visual aids, and audience participation opportunities"</p>
        </div>

        <div class="alert alert-warning">
            <h3>Multiple Requests in One</h3>
            <p><strong>Problem:</strong> "Summarize this and translate it and check for errors"</p>
            <p><strong>Solution:</strong> Break into separate, clear requests or prioritize the most important task</p>
        </div>

        <h2>✨ Clarity Checklist</h2>

        <p>Before sending your prompt, ask yourself:</p>
        <ul>
            <li>✅ Is my request specific and actionable?</li>
            <li>✅ Have I defined any ambiguous terms?</li>
            <li>✅ Is the desired output format clear?</li>
            <li>✅ Are there any pronouns that could be confusing?</li>
            <li>✅ Have I set appropriate scope and boundaries?</li>
        </ul>

        <div class="alert alert-success">
            <p><strong>Pro Tip:</strong> If you can't explain what you want to a colleague in one clear sentence, your prompt probably needs more clarity!</p>
        </div>

        <h2>🎯 Practice Examples</h2>

        <div class="code-block">
            <pre>
<strong>Good Clear Prompt:</strong>

Write a 300-word product description for a wireless bluetooth speaker targeting young professionals aged 25-35. 

Key features to highlight:
- 20-hour battery life
- Waterproof design
- Premium sound quality
- Portable size

Tone: Energetic and modern
Format: 2-3 paragraphs with bullet points for key features
Include a compelling call-to-action at the end.
            </pre>
        </div>

        <p>Ready to practice? Let's move on to the exercises where you'll refine your clarity skills!</p>
    `
}; 
