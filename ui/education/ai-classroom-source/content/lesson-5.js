export const lesson5 = {
    id: 'lesson-5',
    title: 'Lesson 5: Formatting Output & Speaking for Claude',
    content: `
        <h1>Lesson 5: Formatting Output & Speaking for Claude</h1>
        
        <p>Getting Claude to format responses exactly how you want them is a crucial skill. This lesson covers how to specify output formats and use "speaking for Claude" techniques to guide response structure.</p>

        <h2>📋 Output Formatting Basics</h2>
        
        <p>Claude can produce responses in virtually any format you specify. The key is being explicit about what you want.</p>

        <div class="component-box">
            <h3>Common Format Specifications</h3>
            <ul>
                <li><strong>Length:</strong> "in exactly 150 words", "in 3-5 sentences"</li>
                <li><strong>Structure:</strong> "as a bulleted list", "in table format"</li>
                <li><strong>Style:</strong> "in JSON format", "as a formal report"</li>
                <li><strong>Sections:</strong> "with headers for each main point"</li>
            </ul>
        </div>

        <h2>🎯 Specific Format Examples</h2>

        <div class="component-box">
            <h3>Bulleted Lists</h3>
            <div class="code-block">
                <pre>List the top 5 benefits of remote work in bullet points, with each point being exactly one sentence.</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Structured Reports</h3>
            <div class="code-block">
                <pre>Write a project status report with the following sections:
- Executive Summary (50 words)
- Key Achievements (3 bullet points)
- Current Challenges (2 bullet points)
- Next Steps (3 numbered items)</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Table Format</h3>
            <div class="code-block">
                <pre>Create a comparison table with 4 columns: Feature, Product A, Product B, Winner. Include 5 key features.</pre>
            </div>
        </div>

        <h2>🗣️ Speaking for Claude Technique</h2>
        
        <p>"Speaking for Claude" means providing the beginning of Claude's response to guide the format and tone. This is incredibly powerful for ensuring consistent output.</p>

        <div class="component-box">
            <h3>Basic Speaking for Claude</h3>
            <div class="code-block">
                <pre>Explain the benefits of exercise. Start your response with:

"Regular exercise provides three main categories of benefits:"</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Advanced Speaking for Claude</h3>
            <div class="code-block">
                <pre>Analyze this marketing campaign. Structure your response as follows:

"Campaign Analysis Report

Executive Summary:
[Your analysis here]

Strengths:
1. 
2. 
3. 

Areas for Improvement:
1. 
2. 

Recommendation:
Based on this analysis, I recommend..."</pre>
            </div>
        </div>

        <h2>📊 Format Templates</h2>

        <div class="comparison">
            <div class="good-example">
                <h4>✅ Email Format</h4>
                <div class="code-block">
                    <pre>Write a professional email declining a meeting. Use this format:

Subject: [Subject line]

Dear [Name],

[Opening paragraph]

[Explanation paragraph]

[Alternative suggestion]

Best regards,
[Your name]</pre>
                </div>
            </div>
            
            <div class="good-example">
                <h4>✅ JSON Output</h4>
                <div class="code-block">
                    <pre>Extract key information and format as JSON:

{
  "title": "",
  "main_points": [],
  "sentiment": "",
  "action_items": []
}</pre>
                </div>
            </div>
        </div>

        <h2>🔧 Advanced Formatting Techniques</h2>

        <div class="component-box">
            <h3>Conditional Formatting</h3>
            <div class="code-block">
                <pre>If the sentiment is positive, start with "✅ Good news:"
If the sentiment is negative, start with "⚠️ Concern identified:"
If the sentiment is neutral, start with "ℹ️ Analysis shows:"</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Multi-format Responses</h3>
            <div class="code-block">
                <pre>Provide your analysis in two formats:

1. Executive Summary (3 sentences)
2. Detailed Breakdown (bulleted list with explanations)</pre>
            </div>
        </div>

        <h2>📝 Format Specification Patterns</h2>

        <div class="component-box">
            <h3>Pattern 1: Template with Placeholders</h3>
            <div class="code-block">
                <pre>Use exactly this format:

**Problem:** [State the problem]
**Impact:** [Describe the impact]
**Solution:** [Propose solution]
**Timeline:** [Implementation timeline]</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Pattern 2: Numbered Structure</h3>
            <div class="code-block">
                <pre>Format your response as:

1. Introduction (1 sentence)
2. Three main points (2-3 sentences each)
3. Conclusion with recommendation (1 sentence)</pre>
            </div>
        </div>

        <h2>⚡ Pro Tips for Output Control</h2>

        <div class="alert alert-info">
            <h3>✅ Best Practices:</h3>
            <ul>
                <li>Be specific about word counts, sentence limits, or bullet point numbers</li>
                <li>Use "speaking for Claude" to establish tone and structure</li>
                <li>Provide exact templates when you need consistent formatting</li>
                <li>Test your format specifications with simple examples first</li>
            </ul>
        </div>

        <div class="alert alert-warning">
            <h3>❌ Common Mistakes:</h3>
            <ul>
                <li>Being vague about format requirements</li>
                <li>Asking for too many different formats in one prompt</li>
                <li>Not providing examples of the desired output</li>
                <li>Forgetting to specify important formatting details</li>
            </ul>
        </div>

        <h2>🎨 Creative Format Applications</h2>

        <div class="component-box">
            <h3>Storytelling Format</h3>
            <div class="code-block">
                <pre>Explain this technical concept as a story. Begin with:

"Once upon a time, in the world of data processing, there was a problem that needed solving..."</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Dialogue Format</h3>
            <div class="code-block">
                <pre>Present the pros and cons as a conversation between two experts:

Expert A: "I believe the main advantage is..."
Expert B: "That's a good point, but we should also consider..."</pre>
            </div>
        </div>

        <div class="alert alert-success">
            <p><strong>Key Insight:</strong> The more specific you are about format, the more consistent and useful Claude's responses will be. Format control is one of the most practical skills in prompt engineering!</p>
        </div>

        <p>Ready to master output formatting? Let's practice with some hands-on exercises!</p>
    `
}; 
