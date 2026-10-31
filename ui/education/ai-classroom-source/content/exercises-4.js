export const exercises4 = {
    id: 'exercises-4',
    title: 'Exercises 4: Separating Data and Instructions',
    content: `
        <h1>Exercises 4: Separating Data and Instructions</h1>
        
        <p>Practice the crucial skill of clearly separating your instructions from the data you want Claude to process.</p>

        <div class="exercise-container">
            <h2>🎯 Exercise 4.1: Fix the Mixed Prompt</h2>
            
            <p><strong>Problem:</strong> The following prompt mixes instructions and data, making it confusing.</p>
            
            <div class="poor-prompt">
                <h4>❌ Mixed Prompt:</h4>
                <p>"Analyze the sentiment of this customer feedback. The service was terrible and the staff was rude. Please categorize as positive, negative, or neutral. I waited 30 minutes for my order. Also provide a confidence score. The food was cold when it arrived."</p>
            </div>
            
            <div class="exercise-input">
                <label for="exercise-4-1">Your properly separated prompt:</label>
                <textarea id="exercise-4-1" rows="8" placeholder="Separate the instructions from the data clearly..."></textarea>
                <button onclick="runExercise('4-1')" class="btn btn-primary">Test Your Separated Prompt</button>
            </div>
            
            <div id="result-4-1" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Hint</summary>
                    <p>Use clear labels like "Instructions:" and "Data:" or XML-style tags. Put all the task requirements in the instructions section, and all the content to analyze in the data section.</p>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 4.2: Multiple Data Sources</h2>
            
            <p><strong>Scenario:</strong> You need to compare two product reviews and identify key differences.</p>
            
            <p><strong>Your task:</strong> Create a well-structured prompt that clearly separates the task from the two data sources.</p>
            
            <div class="exercise-input">
                <label for="exercise-4-2">Your multi-source separation prompt:</label>
                <textarea id="exercise-4-2" rows="10" placeholder="Structure a prompt with clear instructions and two separate data sources..."></textarea>
                <button onclick="runExercise('4-2')" class="btn btn-primary">Test Your Prompt</button>
            </div>
            
            <div id="result-4-2" class="exercise-result"></div>
            
            <div class="solution-box">
                <details>
                    <summary>✅ Sample Structure</summary>
                    <div class="code-block">
                        <pre>Instructions: Compare these two product reviews and identify the 3 main differences in customer experience. Focus on service quality, product satisfaction, and overall sentiment.

Review A:
"""
[First review content]
"""

Review B:
"""
[Second review content]
"""</pre>
                    </div>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 4.3: XML-Style Tag Practice</h2>
            
            <p><strong>Challenge:</strong> Use XML-style tags to separate instructions from data for analyzing an email.</p>
            
            <div class="exercise-input">
                <label for="exercise-4-3">Your XML-tagged prompt:</label>
                <textarea id="exercise-4-3" rows="10" placeholder="Use XML-style tags to structure your prompt..."></textarea>
                <button onclick="runExercise('4-3')" class="btn btn-primary">Test XML Structure</button>
            </div>
            
            <div id="result-4-3" class="exercise-result"></div>
            
            <p><strong>Task:</strong> Analyze an email for tone, urgency level, and required actions.</p>
            <p><strong>Sample email content:</strong> "Hi team, I need the quarterly report by end of day tomorrow. This is critical for the board meeting. Please prioritize this over other tasks. Let me know if you have any questions. Thanks!"</p>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 4.4: Separation Method Comparison</h2>
            
            <p>Compare different separation methods for the same task. Try both approaches and see which works better:</p>
            
            <div class="comparison-exercise">
                <div class="prompt-option">
                    <h4>Method A: Simple Labels</h4>
                    <div class="code-block">
                        <pre>Instructions: Extract key themes from the text below.

Data: 
"Remote work has changed how we collaborate. Teams now rely on digital tools for communication. Some employees prefer the flexibility, while others miss in-person interactions."</pre>
                    </div>
                    <button onclick="comparePrompts('A-4', 'Instructions: Extract key themes from the text below.\n\nData:\n\"Remote work has changed how we collaborate. Teams now rely on digital tools for communication. Some employees prefer the flexibility, while others miss in-person interactions.\"')" class="btn btn-secondary">Try Simple Labels</button>
                </div>
                
                <div class="prompt-option">
                    <h4>Method B: XML Tags</h4>
                    <div class="code-block">
                        <pre>&lt;instructions&gt;
Extract key themes from the text below.
&lt;/instructions&gt;

&lt;text&gt;
Remote work has changed how we collaborate. Teams now rely on digital tools for communication. Some employees prefer the flexibility, while others miss in-person interactions.
&lt;/text&gt;</pre>
                    </div>
                    <button onclick="comparePrompts('B-4', '<instructions>\nExtract key themes from the text below.\n</instructions>\n\n<text>\nRemote work has changed how we collaborate. Teams now rely on digital tools for communication. Some employees prefer the flexibility, while others miss in-person interactions.\n</text>')" class="btn btn-secondary">Try XML Tags</button>
                </div>
            </div>
            
            <div id="comparison-results-4" class="comparison-results"></div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 4.5: Complex Data Structure</h2>
            
            <p><strong>Advanced Challenge:</strong> Create a prompt that handles multiple types of data with context.</p>
            
            <p><strong>Scenario:</strong> You have customer survey data, sales figures, and competitor analysis that need to be processed together.</p>
            
            <div class="exercise-input">
                <label for="exercise-4-5">Your complex data separation prompt:</label>
                <textarea id="exercise-4-5" rows="12" placeholder="Structure a prompt with multiple data types and clear context..."></textarea>
                <button onclick="runExercise('4-5')" class="btn btn-primary">Test Complex Structure</button>
            </div>
            
            <div id="result-4-5" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Advanced Structure Hint</summary>
                    <p>Consider using:</p>
                    <ul>
                        <li>Clear task description with context</li>
                        <li>Separate sections for each data type</li>
                        <li>Descriptive labels for what each data set represents</li>
                        <li>Specific output format requirements</li>
                    </ul>
                </details>
            </div>
        </div>

        <div class="alert alert-success">
            <p><strong>Key Takeaways from Data Separation:</strong></p>
            <ul>
                <li>Clear separation prevents Claude from confusing instructions with data</li>
                <li>Consistent labeling helps maintain structure across conversations</li>
                <li>XML-style tags work well for complex, multi-part data</li>
                <li>Simple labels are sufficient for straightforward tasks</li>
                <li>Always put instructions first, then data</li>
                <li>Use visual separators and clear boundaries</li>
            </ul>
        </div>
    `
};

export const exerciseHints4 = {
    '4-1': {
        hint: "Identify what parts are instructions (analyze sentiment, categorize, provide confidence score) vs. what parts are data (the actual customer feedback). Separate them clearly.",
        solution: `Instructions: Analyze the sentiment of the following customer feedback. Categorize it as positive, negative, or neutral, and provide a confidence score from 1-10.

Data:
"The service was terrible and the staff was rude. I waited 30 minutes for my order. The food was cold when it arrived."`
    },
    '4-2': {
        hint: "Structure with clear instructions first, then label each review distinctly. Consider using triple quotes or XML tags for each review.",
        solution: `Instructions: Compare these two product reviews and identify the 3 main differences in customer experience. Focus on service quality, product satisfaction, and overall sentiment.

Review A:
"""
The product arrived quickly and works perfectly. Customer service was helpful when I had questions. Highly recommend this company.
"""

Review B:
"""
Shipping took forever and the item was damaged. When I contacted support, they were unresponsive. Very disappointed with this purchase.
"""`
    },
    '4-3': {
        hint: "Use <instructions> and <email> tags to clearly separate the task from the email content. Be specific about what analysis you want.",
        solution: `<instructions>
Analyze the following email for:
1. Tone (professional, urgent, casual, etc.)
2. Urgency level (low, medium, high)
3. Required actions and deadlines
</instructions>

<email>
Hi team, I need the quarterly report by end of day tomorrow. This is critical for the board meeting. Please prioritize this over other tasks. Let me know if you have any questions. Thanks!
</email>`
    },
    '4-5': {
        hint: "Create sections for each data type with clear context about what each represents. Include specific instructions about how to synthesize the different data sources.",
        solution: `Instructions: Analyze the business performance data below and provide a comprehensive assessment with recommendations. Consider customer satisfaction, financial performance, and competitive position.

Context: Q3 2024 business review for TechStart Inc.

Customer Survey Data:
<survey>
Average satisfaction: 7.2/10
Top complaint: Slow response times
Top praise: Product reliability
</survey>

Sales Figures:
<sales>
Q3 Revenue: $2.1M (15% increase from Q2)
Customer acquisition: 450 new customers
Churn rate: 8%
</sales>

Competitor Analysis:
<competition>
Main competitor pricing: 20% lower
Our feature advantage: Advanced analytics
Market share: We hold 12% vs competitor's 25%
</competition>`
    }
}; 
