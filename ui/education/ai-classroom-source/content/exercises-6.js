export const exercises6 = {
    id: 'exercises-6',
    title: 'Exercises 6: Precognition (Thinking Step by Step)',
    content: `
        <h1>Exercises 6: Precognition (Thinking Step by Step)</h1>
        
        <p>Practice the powerful technique of asking Claude to think step-by-step for better reasoning and more accurate results.</p>

        <div class="exercise-container">
            <h2>🎯 Exercise 6.1: Basic Step-by-Step</h2>
            
            <p><strong>Challenge:</strong> Transform a direct question into a step-by-step thinking prompt.</p>
            
            <p><strong>Original question:</strong> "Should I invest in electric vehicle stocks?"</p>
            
            <div class="exercise-input">
                <label for="exercise-6-1">Your step-by-step version:</label>
                <textarea id="exercise-6-1" rows="8" placeholder="Rewrite to encourage step-by-step thinking..."></textarea>
                <button onclick="runExercise('6-1')" class="btn btn-primary">Test Step-by-Step Approach</button>
            </div>
            
            <div id="result-6-1" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Hint</summary>
                    <p>Break the investment decision into logical steps: market analysis, risk assessment, personal financial situation, timeline considerations, and final recommendation.</p>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 6.2: Multi-Perspective Analysis</h2>
            
            <p><strong>Scenario:</strong> A company is considering implementing a 4-day work week.</p>
            
            <p><strong>Task:</strong> Create a prompt that asks Claude to analyze this from multiple perspectives before making a recommendation.</p>
            
            <div class="exercise-input">
                <label for="exercise-6-2">Your multi-perspective prompt:</label>
                <textarea id="exercise-6-2" rows="10" placeholder="Structure a prompt that considers different viewpoints..."></textarea>
                <button onclick="runExercise('6-2')" class="btn btn-primary">Test Multi-Perspective Analysis</button>
            </div>
            
            <div id="result-6-2" class="exercise-result"></div>
            
            <div class="solution-box">
                <details>
                    <summary>✅ Sample Multi-Perspective Structure</summary>
                    <div class="code-block">
                        <pre>Analyze implementing a 4-day work week from these perspectives:

1. Employee perspective: How would this affect work-life balance, productivity, job satisfaction?
2. Management perspective: What are the operational challenges and benefits?
3. Customer perspective: How might service quality or availability be impacted?
4. Financial perspective: What are the cost implications and ROI considerations?
5. Competitive perspective: How does this affect market positioning?

Then synthesize these viewpoints into a balanced recommendation.</pre>
                    </div>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 6.3: Problem Decomposition</h2>
            
            <p><strong>Complex Problem:</strong> A small business is struggling with customer retention.</p>
            
            <div class="exercise-input">
                <label for="exercise-6-3">Your problem decomposition prompt:</label>
                <textarea id="exercise-6-3" rows="10" placeholder="Break this complex problem into manageable parts..."></textarea>
                <button onclick="runExercise('6-3')" class="btn btn-primary">Test Problem Breakdown</button>
            </div>
            
            <div id="result-6-3" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Decomposition Strategy</summary>
                    <p>Consider breaking down into: root cause identification, customer journey analysis, competitive factors, internal processes, and solution development phases.</p>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 6.4: Verification and Self-Checking</h2>
            
            <p><strong>Math Problem:</strong> A restaurant wants to calculate optimal pricing for a new menu item.</p>
            
            <div class="exercise-input">
                <label for="exercise-6-4">Your verification-enhanced prompt:</label>
                <textarea id="exercise-6-4" rows="8" placeholder="Include self-checking and verification steps..."></textarea>
                <button onclick="runExercise('6-4')" class="btn btn-primary">Test Verification Approach</button>
            </div>
            
            <div id="result-6-4" class="exercise-result"></div>
            
            <p><strong>Given data:</strong> Food cost: $8, Labor cost: $3, Overhead: $2, Target profit margin: 30%, Competitor prices: $18-$22</p>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 6.5: Creative Step-by-Step</h2>
            
            <p><strong>Creative Challenge:</strong> Design a prompt for writing a compelling product launch announcement.</p>
            
            <div class="exercise-input">
                <label for="exercise-6-5">Your creative step-by-step prompt:</label>
                <textarea id="exercise-6-5" rows="10" placeholder="Structure the creative process step by step..."></textarea>
                <button onclick="runExercise('6-5')" class="btn btn-primary">Test Creative Process</button>
            </div>
            
            <div id="result-6-5" class="exercise-result"></div>
            
            <p><strong>Product:</strong> AI-powered fitness app with personalized workout plans</p>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 6.6: Comparison Study</h2>
            
            <p>Compare direct vs. step-by-step approaches for the same question:</p>
            
            <div class="comparison-exercise">
                <div class="prompt-option">
                    <h4>Direct Approach</h4>
                    <div class="code-block">
                        <pre>What are the main challenges of remote team management?</pre>
                    </div>
                    <button onclick="comparePrompts('A-6', 'What are the main challenges of remote team management?')" class="btn btn-secondary">Try Direct Approach</button>
                </div>
                
                <div class="prompt-option">
                    <h4>Step-by-Step Approach</h4>
                    <div class="code-block">
                        <pre>Think step by step about remote team management challenges:

1. First, consider the fundamental differences between remote and in-person management
2. Then, identify specific areas where challenges commonly arise
3. Next, analyze why these challenges occur in remote settings
4. Finally, categorize and prioritize the main challenges

What are the main challenges of remote team management?</pre>
                    </div>
                    <button onclick="comparePrompts('B-6', 'Think step by step about remote team management challenges:\n\n1. First, consider the fundamental differences between remote and in-person management\n2. Then, identify specific areas where challenges commonly arise\n3. Next, analyze why these challenges occur in remote settings\n4. Finally, categorize and prioritize the main challenges\n\nWhat are the main challenges of remote team management?')" class="btn btn-secondary">Try Step-by-Step</button>
                </div>
            </div>
            
            <div id="comparison-results-6" class="comparison-results"></div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 6.7: Scenario Planning</h2>
            
            <p><strong>Business Scenario:</strong> A tech startup is deciding whether to raise venture capital funding.</p>
            
            <div class="exercise-input">
                <label for="exercise-6-7">Your scenario planning prompt:</label>
                <textarea id="exercise-6-7" rows="10" placeholder="Create a prompt that explores different scenarios..."></textarea>
                <button onclick="runExercise('6-7')" class="btn btn-primary">Test Scenario Planning</button>
            </div>
            
            <div id="result-6-7" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Scenario Types</summary>
                    <ul>
                        <li>Best case: Successful funding with ideal terms</li>
                        <li>Worst case: Funding rejection or poor terms</li>
                        <li>Alternative: Bootstrapping or other funding sources</li>
                        <li>Timing: Different market conditions</li>
                    </ul>
                </details>
            </div>
        </div>

        <div class="alert alert-success">
            <p><strong>Step-by-Step Thinking Mastery:</strong></p>
            <ul>
                <li>Breaking problems into steps improves solution quality</li>
                <li>Multiple perspectives provide more comprehensive analysis</li>
                <li>Verification steps catch errors and improve accuracy</li>
                <li>Creative processes benefit from structured thinking</li>
                <li>Scenario planning helps prepare for different outcomes</li>
                <li>Complex problems always benefit from decomposition</li>
            </ul>
        </div>
    `
};

export const exerciseHints6 = {
    '6-1': {
        hint: "Structure the investment decision as a logical sequence: market analysis, company fundamentals, risk assessment, personal factors, and final recommendation.",
        solution: `Think step by step about whether to invest in electric vehicle stocks:

1. First, analyze the current EV market trends and growth projections
2. Then, evaluate the competitive landscape and key players
3. Next, assess the risks and challenges facing the EV industry
4. Consider my personal financial situation, risk tolerance, and investment timeline
5. Finally, weigh all factors and provide a reasoned investment recommendation

Should I invest in electric vehicle stocks?`
    },
    '6-2': {
        hint: "Structure the analysis to systematically consider each stakeholder group's interests and concerns before synthesizing into a balanced recommendation.",
        solution: `Analyze implementing a 4-day work week from these perspectives:

1. Employee perspective: How would this affect work-life balance, productivity, job satisfaction?
2. Management perspective: What are the operational challenges and benefits?
3. Customer perspective: How might service quality or availability be impacted?
4. Financial perspective: What are the cost implications and ROI considerations?
5. Competitive perspective: How does this affect market positioning?

Then synthesize these viewpoints into a balanced recommendation.`
    },
    '6-3': {
        hint: "Break down customer retention into its component parts: understanding why customers leave, analyzing the customer journey, identifying intervention points, and developing targeted solutions.",
        solution: `Break down the customer retention problem systematically:

1. Root cause identification: Why are customers leaving? Analyze patterns and feedback
2. Customer journey mapping: Where in the customer lifecycle do we lose people?
3. Competitive analysis: How do our retention rates compare to competitors?
4. Internal process review: What operational issues might affect customer satisfaction?
5. Solution development: Based on the analysis, what specific retention strategies should we implement?
6. Success metrics: How will we measure improvement in retention?

Problem: A small business is struggling with customer retention.`
    },
    '6-4': {
        hint: "Include calculation steps, verification of math, consideration of market factors, and double-checking the final recommendation against business objectives.",
        solution: `Calculate optimal pricing for the new menu item step by step, then verify your work:

1. Calculate base cost: Add food cost ($8) + labor cost ($3) + overhead ($2)
2. Apply profit margin: Calculate price needed for 30% profit margin
3. Market comparison: Compare calculated price with competitor range ($18-$22)
4. Verification: Double-check all calculations and ensure the price makes business sense
5. Final recommendation: Provide the optimal price with reasoning

Given data: Food cost: $8, Labor cost: $3, Overhead: $2, Target profit margin: 30%, Competitor prices: $18-$22`
    },
    '6-5': {
        hint: "Structure the creative process: audience analysis, key message development, tone selection, content structure planning, and final writing with review.",
        solution: `Write a compelling product launch announcement by thinking through this step by step:

1. Audience analysis: Who is the target audience and what motivates them?
2. Key benefits identification: What are the most compelling features of the AI fitness app?
3. Emotional hook development: What story or pain point will grab attention?
4. Structure planning: How should the announcement flow (hook, benefits, social proof, call-to-action)?
5. Tone and voice: What writing style will resonate with fitness enthusiasts?
6. Draft and refine: Write the announcement and review for impact

Product: AI-powered fitness app with personalized workout plans`
    },
    '6-7': {
        hint: "Consider multiple funding scenarios with different outcomes and their strategic implications for the company's future.",
        solution: `Think through the VC funding decision by exploring different scenarios:

1. Best case scenario: Successful funding with favorable terms - what opportunities does this create?
2. Worst case scenario: Funding rejection or unfavorable terms - what are the alternatives?
3. Most likely scenario: Moderate success with standard terms - how does this impact growth plans?
4. Alternative scenarios: Bootstrap longer, seek other funding sources - what are the trade-offs?
5. For each scenario, analyze: timeline implications, control/equity considerations, growth potential
6. Strategic recommendation: Based on scenario analysis, what's the best path forward?

Decision: Should a tech startup raise venture capital funding?`
    }
}; 
