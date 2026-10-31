export const exercises2 = {
    id: 'exercises-2',
    title: 'Exercises 2: Being Clear and Direct',
    content: `
        <h1>Exercises 2: Being Clear and Direct</h1>
        
        <p>Practice making your prompts clearer and more direct with these hands-on exercises.</p>

        <div class="exercise-container">
            <h2>🎯 Exercise 2.1: Clarify the Vague Prompt</h2>
            
            <p><strong>Challenge:</strong> The following prompt is too vague. Make it clear and specific.</p>
            
            <div class="poor-prompt">
                <h4>❌ Vague Prompt:</h4>
                <p>"Help me with my presentation"</p>
            </div>
            
            <p><strong>Context:</strong> You're preparing a 10-minute presentation about renewable energy for a high school science class.</p>
            
            <div class="exercise-input">
                <label for="exercise-2-1">Your clear and specific prompt:</label>
                <textarea id="exercise-2-1" rows="6" placeholder="Rewrite the prompt with specific, clear instructions..."></textarea>
                <button onclick="runExercise('2-1')" class="btn btn-primary">Test Your Prompt</button>
            </div>
            
            <div id="result-2-1" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Hint</summary>
                    <p>Think about: What specific help do you need? What's the presentation about? Who's the audience? What format do you want? How long should it be?</p>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 2.2: Remove Ambiguity</h2>
            
            <p>Identify and fix the ambiguous elements in this prompt:</p>
            
            <div class="poor-prompt">
                <h4>❌ Ambiguous Prompt:</h4>
                <p>"Analyze this data and tell me what it means and if there are any problems with it"</p>
            </div>
            
            <p><strong>Context:</strong> You have a CSV file with customer satisfaction survey results from 500 respondents.</p>
            
            <div class="exercise-input">
                <label for="exercise-2-2">Your clear, unambiguous prompt:</label>
                <textarea id="exercise-2-2" rows="6" placeholder="Remove all ambiguity and be specific..."></textarea>
                <button onclick="runExercise('2-2')" class="btn btn-primary">Test Your Prompt</button>
            </div>
            
            <div id="result-2-2" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Hint</summary>
                    <p>What does "analyze" mean specifically? What kind of "problems"? What does "what it means" refer to? Be specific about the type of analysis and output format you want.</p>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 2.3: Specify Output Format</h2>
            
            <p>Transform this request to include clear output formatting instructions:</p>
            
            <div class="poor-prompt">
                <h4>❌ Unclear Format:</h4>
                <p>"Explain the benefits of exercise"</p>
            </div>
            
            <div class="exercise-input">
                <label for="exercise-2-3">Your prompt with clear format specifications:</label>
                <textarea id="exercise-2-3" rows="6" placeholder="Add specific formatting and structure requirements..."></textarea>
                <button onclick="runExercise('2-3')" class="btn btn-primary">Test Your Prompt</button>
            </div>
            
            <div id="result-2-3" class="exercise-result"></div>
            
            <div class="solution-box">
                <details>
                    <summary>✅ Sample Solution</summary>
                    <div class="code-block">
                        <pre>Explain the benefits of regular exercise in exactly 250 words, structured as follows:

1. Introduction paragraph (50 words)
2. Three main benefit categories with headers:
   - Physical Health Benefits (70 words)
   - Mental Health Benefits (70 words)  
   - Social Benefits (60 words)

Target audience: Adults aged 30-50 who are new to exercise
Tone: Encouraging and informative
Include specific examples for each benefit category.</pre>
                    </div>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 2.4: Clarity Comparison</h2>
            
            <p>Compare these two prompts and see the difference clarity makes:</p>
            
            <div class="comparison-exercise">
                <div class="prompt-option">
                    <h4>Prompt A (Unclear)</h4>
                    <div class="code-block">
                        <pre>Write something about climate change that's good</pre>
                    </div>
                    <button onclick="comparePrompts('A-2', 'Write something about climate change that is good')" class="btn btn-secondary">Try Unclear Prompt</button>
                </div>
                
                <div class="prompt-option">
                    <h4>Prompt B (Clear)</h4>
                    <div class="code-block">
                        <pre>Write a 400-word informative article about practical solutions to climate change for homeowners. Include 5 specific actions people can take, with estimated cost and environmental impact for each. Use an optimistic, solution-focused tone suitable for a general audience.</pre>
                    </div>
                    <button onclick="comparePrompts('B-2', 'Write a 400-word informative article about practical solutions to climate change for homeowners. Include 5 specific actions people can take, with estimated cost and environmental impact for each. Use an optimistic, solution-focused tone suitable for a general audience.')" class="btn btn-secondary">Try Clear Prompt</button>
                </div>
            </div>
            
            <div id="comparison-results-2" class="comparison-results"></div>
        </div>

        <div class="alert alert-success">
            <p><strong>Key Takeaways:</strong></p>
            <ul>
                <li>Specific instructions lead to more useful and predictable outputs</li>
                <li>Defining scope, audience, and format prevents ambiguity</li>
                <li>Clear prompts save time by reducing the need for follow-up clarifications</li>
                <li>Active voice and concrete examples improve prompt effectiveness</li>
            </ul>
        </div>
    `
};

export const exerciseHints2 = {
    '2-1': {
        hint: "Consider what specific help you need: outline creation, content suggestions, slide structure, speaker notes, or visual recommendations?",
        solution: `Create a detailed outline for a 10-minute presentation about renewable energy for high school students (ages 15-17).

Requirements:
- Include 5 main topics with 2-3 subtopics each
- Suggest engaging opening hook and strong conclusion
- Recommend 3-4 visual elements or demonstrations
- Provide timing estimates for each section
- Use language appropriate for teenagers
- Focus on practical applications and future career opportunities

Format: Structured outline with bullet points and timing notes.`
    },
    '2-2': {
        hint: "Be specific about what type of analysis (descriptive statistics, trends, correlations), what problems to look for (data quality, outliers, bias), and what format you want the results in.",
        solution: `Analyze this customer satisfaction survey data (500 respondents) and provide:

1. Descriptive statistics: mean, median, mode for all rating questions
2. Key trends: highest and lowest satisfaction areas
3. Data quality assessment: missing responses, outliers, potential bias
4. Three main insights with supporting evidence
5. Two actionable recommendations based on findings

Format: Executive summary (150 words) followed by detailed analysis with charts/tables suggestions.
Highlight any data integrity issues that could affect reliability.`
    },
    '2-3': {
        hint: "Specify word count, structure (paragraphs, bullet points, headers), target audience, tone, and what specific aspects of exercise benefits to cover.",
        solution: `Explain the benefits of regular exercise in exactly 250 words, structured as follows:

1. Introduction paragraph (50 words)
2. Three main benefit categories with headers:
   - Physical Health Benefits (70 words)
   - Mental Health Benefits (70 words)  
   - Social Benefits (60 words)

Target audience: Adults aged 30-50 who are new to exercise
Tone: Encouraging and informative
Include specific examples for each benefit category.`
    }
}; 
