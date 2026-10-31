export const lesson4 = {
    id: 'lesson-4',
    title: 'Lesson 4: Separating Data and Instructions',
    content: `
        <h1>Lesson 4: Separating Data and Instructions</h1>
        
        <p>One of the most powerful techniques in prompt engineering is clearly separating your instructions from the data you want Claude to work with. This prevents confusion and leads to more accurate results.</p>

        <h2>🔍 Why Separate Data and Instructions?</h2>
        
        <p>When instructions and data are mixed together, Claude might:</p>
        <ul>
            <li>Mistake data for instructions (or vice versa)</li>
            <li>Apply instructions to the wrong parts of your content</li>
            <li>Miss important data elements</li>
            <li>Produce inconsistent results</li>
        </ul>

        <h2>📝 Basic Separation Techniques</h2>

        <div class="component-box">
            <h3>Method 1: Clear Labeling</h3>
            <div class="code-block">
                <pre>Instructions: [Your task description]

Data: [The content to work with]</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Method 2: XML-style Tags</h3>
            <div class="code-block">
                <pre>&lt;instructions&gt;
[Your task description]
&lt;/instructions&gt;

&lt;data&gt;
[The content to work with]
&lt;/data&gt;</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Method 3: Triple Quotes</h3>
            <div class="code-block">
                <pre>Please analyze the following text for sentiment:

\"\"\"
[The text to analyze]
\"\"\"</pre>
            </div>
        </div>

        <h2>🎯 Practical Examples</h2>

        <div class="comparison">
            <div class="poor-example">
                <h4>❌ Mixed Instructions and Data</h4>
                <div class="code-block">
                    <pre>Summarize this article about renewable energy. Solar panels are becoming more efficient each year. Wind turbines now generate 15% of US electricity. Please focus on key statistics. Hydroelectric power provides 6% of global energy. Make it 100 words.</pre>
                </div>
                <small>Confusing - where do instructions end and data begin?</small>
            </div>
            
            <div class="good-example">
                <h4>✅ Clear Separation</h4>
                <div class="code-block">
                    <pre>Instructions: Summarize the following article about renewable energy in exactly 100 words, focusing on key statistics.

Data:
Solar panels are becoming more efficient each year. Wind turbines now generate 15% of US electricity. Hydroelectric power provides 6% of global energy.</pre>
                </div>
                <small>Clear structure - easy to follow</small>
            </div>
        </div>

        <h2>🔧 Advanced Separation Patterns</h2>

        <div class="component-box">
            <h3>Multiple Data Sources</h3>
            <div class="code-block">
                <pre>Task: Compare these two product reviews and identify key differences.

Review A:
\"\"\"
[First review content]
\"\"\"

Review B:
\"\"\"
[Second review content]
\"\"\"</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Complex Data with Context</h3>
            <div class="code-block">
                <pre>Instructions: Analyze the customer feedback below and categorize issues by priority.

Context: This is feedback from our mobile app beta test with 500 users.

Customer Feedback:
&lt;feedback&gt;
[Feedback data here]
&lt;/feedback&gt;</pre>
            </div>
        </div>

        <h2>📊 When to Use Each Method</h2>

        <div class="component-box">
            <h3>Simple Labels (Instructions/Data)</h3>
            <p><strong>Best for:</strong> Short, straightforward tasks</p>
            <div class="example">
                Simple text analysis, basic formatting, quick summaries
            </div>
        </div>

        <div class="component-box">
            <h3>XML-style Tags</h3>
            <p><strong>Best for:</strong> Complex tasks with multiple data sources</p>
            <div class="example">
                Document comparison, multi-step analysis, structured data processing
            </div>
        </div>

        <div class="component-box">
            <h3>Triple Quotes</h3>
            <p><strong>Best for:</strong> Single data source that might contain formatting</p>
            <div class="example">
                Code analysis, email processing, text with special characters
            </div>
        </div>

        <h2>⚡ Pro Tips for Data Separation</h2>

        <div class="alert alert-info">
            <h3>✅ Best Practices:</h3>
            <ul>
                <li>Always put instructions first, data second</li>
                <li>Use consistent labeling throughout your conversation</li>
                <li>Be explicit about what each section contains</li>
                <li>Use clear visual separators (line breaks, tags, etc.)</li>
            </ul>
        </div>

        <div class="alert alert-warning">
            <h3>❌ Common Mistakes:</h3>
            <ul>
                <li>Embedding instructions within data sections</li>
                <li>Using ambiguous separators like single dashes</li>
                <li>Forgetting to label sections clearly</li>
                <li>Mixing multiple data types without clear boundaries</li>
            </ul>
        </div>

        <h2>🎨 Creative Applications</h2>

        <div class="component-box">
            <h3>Role + Data Separation</h3>
            <div class="code-block">
                <pre>You are a professional editor reviewing a draft article.

Instructions: Check for grammar, clarity, and flow. Suggest 3 specific improvements.

Article Draft:
&lt;draft&gt;
[Article content here]
&lt;/draft&gt;</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Multi-step Processing</h3>
            <div class="code-block">
                <pre>Task: 
1. First, identify the main themes in the text
2. Then, rate each theme's importance (1-5)
3. Finally, suggest which theme to focus on

Text to analyze:
\"\"\"
[Content here]
\"\"\"</pre>
            </div>
        </div>

        <div class="alert alert-success">
            <p><strong>Remember:</strong> Clear separation leads to clear results. When Claude knows exactly what to do with what data, you get much more reliable and useful responses!</p>
        </div>

        <p>Ready to practice separating data and instructions? Let's move on to the exercises!</p>
    `
}; 
