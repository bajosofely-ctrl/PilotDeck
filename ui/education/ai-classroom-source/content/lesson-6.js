export const lesson6 = {
    id: 'lesson-6',
    title: 'Lesson 6: Precognition (Thinking Step by Step)',
    content: `
        <h1>Lesson 6: Precognition (Thinking Step by Step)</h1>
        
        <p>"Precognition" in prompt engineering means asking Claude to think through problems step-by-step before providing the final answer. This technique dramatically improves reasoning quality and accuracy.</p>

        <h2>🧠 What is Precognition?</h2>
        
        <p>Precognition involves explicitly asking Claude to:</p>
        <ul>
            <li>Show its reasoning process</li>
            <li>Break down complex problems into steps</li>
            <li>Consider multiple angles before concluding</li>
            <li>Verify its own thinking</li>
        </ul>

        <div class="alert alert-info">
            <p><strong>Why it works:</strong> When Claude "thinks out loud," it catches errors, considers more possibilities, and provides more thorough, accurate responses.</p>
        </div>

        <h2>🔧 Basic Step-by-Step Techniques</h2>

        <div class="component-box">
            <h3>Simple Step-by-Step Request</h3>
            <div class="code-block">
                <pre>Think step by step to solve this problem: [problem]</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Explicit Reasoning Request</h3>
            <div class="code-block">
                <pre>Before giving your final answer, walk me through your reasoning process for: [question]</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Structured Thinking</h3>
            <div class="code-block">
                <pre>Analyze this problem by:
1. First, identifying the key issues
2. Then, considering possible solutions
3. Finally, recommending the best approach

Problem: [description]</pre>
            </div>
        </div>

        <h2>🎯 Precognition Patterns</h2>

        <div class="comparison">
            <div class="poor-example">
                <h4>❌ Direct Question</h4>
                <div class="code-block">
                    <pre>What's the best marketing strategy for a new restaurant?</pre>
                </div>
                <small>May get a generic, surface-level answer</small>
            </div>
            
            <div class="good-example">
                <h4>✅ Step-by-Step Approach</h4>
                <div class="code-block">
                    <pre>I need to develop a marketing strategy for a new restaurant. Please think through this step by step:

1. First, analyze what factors make restaurant marketing successful
2. Then, consider the specific challenges new restaurants face
3. Next, identify the most effective marketing channels for restaurants
4. Finally, recommend a comprehensive strategy

Restaurant details: [location, cuisine type, target audience]</pre>
                </div>
                <small>Encourages thorough, reasoned analysis</small>
            </div>
        </div>

        <h2>🔍 Advanced Precognition Techniques</h2>

        <div class="component-box">
            <h3>Multi-Perspective Analysis</h3>
            <div class="code-block">
                <pre>Think through this problem from multiple angles:

1. Customer perspective: How would customers view this?
2. Business perspective: What are the financial implications?
3. Operational perspective: How would this affect day-to-day operations?
4. Long-term perspective: What are the future consequences?

Then synthesize these viewpoints into a recommendation.</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Verification and Self-Checking</h3>
            <div class="code-block">
                <pre>Solve this problem step by step, then:

1. Double-check your reasoning for any errors
2. Consider if you've missed any important factors
3. Verify your conclusion makes sense
4. Provide your final, verified answer</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Pros and Cons Analysis</h3>
            <div class="code-block">
                <pre>Think through this decision systematically:

1. List all the pros and cons
2. Weigh the importance of each factor
3. Consider potential risks and mitigation strategies
4. Make a reasoned recommendation based on your analysis</pre>
            </div>
        </div>

        <h2>🎨 Creative Applications</h2>

        <div class="component-box">
            <h3>Problem Decomposition</h3>
            <div class="code-block">
                <pre>Break this complex problem into smaller, manageable parts:

1. Identify the main components of the problem
2. Analyze each component separately
3. Understand how the components interact
4. Develop solutions for each part
5. Integrate the solutions into a comprehensive approach</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Scenario Planning</h3>
            <div class="code-block">
                <pre>Think through different scenarios:

1. Best case scenario: What if everything goes perfectly?
2. Worst case scenario: What if major problems occur?
3. Most likely scenario: What's the realistic outcome?
4. For each scenario, what should be the response strategy?</pre>
            </div>
        </div>

        <h2>⚡ Precognition for Different Task Types</h2>

        <div class="component-box">
            <h3>For Analysis Tasks</h3>
            <div class="example">
                "Before analyzing this data, first explain what patterns you're looking for, then walk through your analysis method, and finally present your findings with supporting evidence."
            </div>
        </div>

        <div class="component-box">
            <h3>For Creative Tasks</h3>
            <div class="example">
                "Before writing the story, first brainstorm the key elements (character, setting, conflict), then outline the plot structure, and finally write the complete story."
            </div>
        </div>

        <div class="component-box">
            <h3>For Problem-Solving</h3>
            <div class="example">
                "Before proposing solutions, first clearly define the problem, identify root causes, consider constraints, then generate and evaluate multiple solution options."
            </div>
        </div>

        <h2>🎯 Precognition Templates</h2>

        <div class="code-block">
            <pre>
<strong>Template 1: Analysis Framework</strong>
"Analyze [topic] using this thinking process:
1. Context: What background information is important?
2. Key factors: What are the main elements to consider?
3. Relationships: How do these elements interact?
4. Implications: What does this mean for [specific outcome]?
5. Conclusion: Based on this analysis, what's your assessment?"

<strong>Template 2: Decision Framework</strong>
"Help me make this decision by thinking through:
1. Clarification: What exactly needs to be decided?
2. Options: What are all the possible choices?
3. Criteria: What factors should guide this decision?
4. Evaluation: How does each option perform against the criteria?
5. Recommendation: Which option is best and why?"

<strong>Template 3: Problem-Solving Framework</strong>
"Solve this problem step by step:
1. Problem definition: What exactly is the issue?
2. Root cause analysis: Why is this happening?
3. Solution generation: What are possible solutions?
4. Solution evaluation: What are the pros/cons of each?
5. Implementation: How should the best solution be executed?"
            </pre>
        </div>

        <div class="alert alert-success">
            <p><strong>Pro Tip:</strong> The more complex the problem, the more valuable step-by-step thinking becomes. For simple questions, direct answers work fine. For complex analysis, always use precognition!</p>
        </div>

        <div class="alert alert-warning">
            <h3>When to Use Precognition:</h3>
            <ul>
                <li>✅ Complex analysis or reasoning tasks</li>
                <li>✅ Multi-faceted problems with many variables</li>
                <li>✅ Decisions with significant consequences</li>
                <li>✅ Creative projects requiring planning</li>
                <li>❌ Simple factual questions</li>
                <li>❌ Basic definitions or explanations</li>
            </ul>
        </div>

        <p>Ready to practice step-by-step thinking? Let's move on to exercises that will help you master precognition techniques!</p>
    `
}; 
