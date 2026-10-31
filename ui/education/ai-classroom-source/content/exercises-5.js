export const exercises5 = {
    id: 'exercises-5',
    title: 'Exercises 5: Formatting Output & Speaking for Claude',
    content: `
        <h1>Exercises 5: Formatting Output & Speaking for Claude</h1>
        
        <p>Master the art of controlling Claude's output format and using "speaking for Claude" techniques to get exactly the structure you need.</p>

        <div class="exercise-container">
            <h2>🎯 Exercise 5.1: Specific Format Control</h2>
            
            <p><strong>Challenge:</strong> Get Claude to format a response in exactly the structure you specify.</p>
            
            <p><strong>Task:</strong> Create a prompt that will produce a product comparison in a specific table format.</p>
            
            <div class="exercise-input">
                <label for="exercise-5-1">Your format-controlled prompt:</label>
                <textarea id="exercise-5-1" rows="8" placeholder="Specify exact formatting requirements for a product comparison..."></textarea>
                <button onclick="runExercise('5-1')" class="btn btn-primary">Test Format Control</button>
            </div>
            
            <div id="result-5-1" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Hint</summary>
                    <p>Be very specific about: number of columns, headers, number of rows, what goes in each cell. Consider providing an example structure.</p>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 5.2: Speaking for Claude</h2>
            
            <p><strong>Technique Practice:</strong> Use "speaking for Claude" to guide the response format and tone.</p>
            
            <p><strong>Scenario:</strong> You want Claude to explain a complex topic (cryptocurrency) in a specific way.</p>
            
            <div class="exercise-input">
                <label for="exercise-5-2">Your "speaking for Claude" prompt:</label>
                <textarea id="exercise-5-2" rows="8" placeholder="Provide the beginning of Claude's response to guide format and tone..."></textarea>
                <button onclick="runExercise('5-2')" class="btn btn-primary">Test Speaking Technique</button>
            </div>
            
            <div id="result-5-2" class="exercise-result"></div>
            
            <div class="solution-box">
                <details>
                    <summary>✅ Sample Speaking for Claude</summary>
                    <div class="code-block">
                        <pre>Explain cryptocurrency to a complete beginner. Start your response with:

"Think of cryptocurrency as digital money that works like this:

First, imagine..."</pre>
                    </div>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 5.3: Template-Based Formatting</h2>
            
            <p><strong>Advanced Practice:</strong> Create a detailed template that Claude must follow exactly.</p>
            
            <p><strong>Task:</strong> Design a prompt for analyzing a business problem using a specific template structure.</p>
            
            <div class="exercise-input">
                <label for="exercise-5-3">Your template-based prompt:</label>
                <textarea id="exercise-5-3" rows="10" placeholder="Create a detailed template with placeholders..."></textarea>
                <button onclick="runExercise('5-3')" class="btn btn-primary">Test Template Format</button>
            </div>
            
            <div id="result-5-3" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Template Structure Ideas</summary>
                    <ul>
                        <li>Use **bold headers** for sections</li>
                        <li>Include [placeholder] indicators</li>
                        <li>Specify exact number of points or sentences</li>
                        <li>Add formatting like bullet points or numbering</li>
                    </ul>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 5.4: JSON Output Control</h2>
            
            <p><strong>Technical Challenge:</strong> Get Claude to output information in valid JSON format.</p>
            
            <p><strong>Scenario:</strong> Extract key information from a job posting and format it as JSON.</p>
            
            <div class="exercise-input">
                <label for="exercise-5-4">Your JSON formatting prompt:</label>
                <textarea id="exercise-5-4" rows="8" placeholder="Specify exact JSON structure and field requirements..."></textarea>
                <button onclick="runExercise('5-4')" class="btn btn-primary">Test JSON Output</button>
            </div>
            
            <div id="result-5-4" class="exercise-result"></div>
            
            <p><strong>Sample job posting:</strong> "Senior Software Engineer position at TechCorp. 5+ years experience required. Remote work available. Salary: $120,000-$150,000. Skills needed: Python, React, AWS. Apply by March 15th."</p>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 5.5: Multi-Format Response</h2>
            
            <p><strong>Complex Challenge:</strong> Request the same information in multiple formats within one response.</p>
            
            <div class="exercise-input">
                <label for="exercise-5-5">Your multi-format prompt:</label>
                <textarea id="exercise-5-5" rows="10" placeholder="Request information in multiple formats (summary, detailed list, etc.)..."></textarea>
                <button onclick="runExercise('5-5')" class="btn btn-primary">Test Multi-Format</button>
            </div>
            
            <div id="result-5-5" class="exercise-result"></div>
            
            <p><strong>Topic suggestion:</strong> Benefits of renewable energy (provide as: 1-sentence summary, detailed bullet points, and comparison table)</p>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 5.6: Format Comparison</h2>
            
            <p>See how different format specifications affect the same content:</p>
            
            <div class="comparison-exercise">
                <div class="prompt-option">
                    <h4>Format A: Casual List</h4>
                    <div class="code-block">
                        <pre>List the main benefits of exercise in a casual, conversational way.</pre>
                    </div>
                    <button onclick="comparePrompts('A-5', 'List the main benefits of exercise in a casual, conversational way.')" class="btn btn-secondary">Try Casual Format</button>
                </div>
                
                <div class="prompt-option">
                    <h4>Format B: Formal Report</h4>
                    <div class="code-block">
                        <pre>Provide an analysis of exercise benefits using this format:

**EXECUTIVE SUMMARY**
[2 sentences]

**KEY BENEFITS**
1. [Benefit with 2-sentence explanation]
2. [Benefit with 2-sentence explanation]
3. [Benefit with 2-sentence explanation]

**RECOMMENDATION**
[1 sentence recommendation]</pre>
                    </div>
                    <button onclick="comparePrompts('B-5', 'Provide an analysis of exercise benefits using this format:\n\n**EXECUTIVE SUMMARY**\n[2 sentences]\n\n**KEY BENEFITS**\n1. [Benefit with 2-sentence explanation]\n2. [Benefit with 2-sentence explanation]\n3. [Benefit with 2-sentence explanation]\n\n**RECOMMENDATION**\n[1 sentence recommendation]')" class="btn btn-secondary">Try Formal Format</button>
                </div>
            </div>
            
            <div id="comparison-results-5" class="comparison-results"></div>
        </div>

        <div class="alert alert-success">
            <p><strong>Output Formatting Mastery:</strong></p>
            <ul>
                <li>Specific format instructions lead to consistent, professional results</li>
                <li>"Speaking for Claude" is powerful for establishing tone and structure</li>
                <li>Templates with placeholders ensure exact formatting</li>
                <li>JSON and structured data formats require precise specification</li>
                <li>Different formats serve different purposes and audiences</li>
                <li>Testing format specifications helps refine your prompting skills</li>
            </ul>
        </div>
    `
};

export const exerciseHints5 = {
    '5-1': {
        hint: "Specify the exact table structure: number of columns, column headers, number of products to compare, and what specific information goes in each cell.",
        solution: `Create a product comparison table with exactly 4 columns: Feature, Product A, Product B, and Winner. Compare smartphones with these 5 features: Price, Battery Life, Camera Quality, Storage, and Overall Rating. Format as a clean table with clear headers.

Products to compare: iPhone 15 vs Samsung Galaxy S24`
    },
    '5-2': {
        hint: "Provide the opening words or structure that Claude should use. This guides both the tone and the format of the explanation.",
        solution: `Explain cryptocurrency to a complete beginner. Start your response with:

"Think of cryptocurrency as digital money that works like this:

First, imagine regular money but instead of physical bills and coins, everything exists only on computers..."`
    },
    '5-3': {
        hint: "Create a detailed business analysis template with specific sections, formatting requirements, and placeholder indicators for where Claude should fill in information.",
        solution: `Analyze the following business problem using exactly this template:

**PROBLEM ANALYSIS REPORT**

**Problem Statement:**
[State the core issue in 1-2 sentences]

**Impact Assessment:**
• Financial Impact: [specific impact]
• Operational Impact: [specific impact]  
• Strategic Impact: [specific impact]

**Root Causes:**
1. [Primary cause with explanation]
2. [Secondary cause with explanation]
3. [Contributing factor]

**Recommended Solution:**
[Detailed solution in 2-3 sentences]

**Implementation Timeline:**
• Phase 1: [timeframe and actions]
• Phase 2: [timeframe and actions]
• Phase 3: [timeframe and actions]

**Success Metrics:**
[How to measure if the solution works]`
    },
    '5-4': {
        hint: "Specify the exact JSON structure with field names, data types, and any validation requirements. Provide the schema Claude should follow.",
        solution: `Extract information from the job posting and format as valid JSON with exactly these fields:

{
  "title": "",
  "company": "",
  "experience_required": "",
  "salary_range": "",
  "work_arrangement": "",
  "required_skills": [],
  "application_deadline": "",
  "location": ""
}

Job posting: "Senior Software Engineer position at TechCorp. 5+ years experience required. Remote work available. Salary: $120,000-$150,000. Skills needed: Python, React, AWS. Apply by March 15th."`
    },
    '5-5': {
        hint: "Structure your request to clearly separate each format requirement. Use numbered sections or clear headers to distinguish between the different output formats.",
        solution: `Explain the benefits of renewable energy in three different formats:

1. **One-Sentence Summary:** [Capture the essence in exactly one sentence]

2. **Detailed Benefits List:** 
   • [Benefit 1 with 2-sentence explanation]
   • [Benefit 2 with 2-sentence explanation] 
   • [Benefit 3 with 2-sentence explanation]

3. **Comparison Table:**
   | Energy Source | Cost | Environmental Impact | Reliability |
   |---------------|------|---------------------|-------------|
   | Solar         | [rating] | [impact] | [reliability] |`
    }
}; 
