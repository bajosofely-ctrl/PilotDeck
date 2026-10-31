export const lesson3 = {
    id: 'lesson-3',
    title: 'Lesson 3: Assigning Roles (Role Prompting)',
    content: `
        <h1>Lesson 3: Assigning Roles (Role Prompting)</h1>
        
        <p>Role prompting is a powerful technique where you assign Claude a specific role, persona, or expertise area. This helps Claude respond with the appropriate knowledge, tone, and perspective for your needs.</p>

        <h2>🎭 What is Role Prompting?</h2>
        
        <p>Role prompting means telling Claude to act as a specific type of expert, professional, or character. This primes Claude to:</p>
        <ul>
            <li>Use domain-specific knowledge and terminology</li>
            <li>Adopt appropriate tone and communication style</li>
            <li>Apply relevant frameworks and methodologies</li>
            <li>Consider context from that role's perspective</li>
        </ul>

        <h2>🎯 Basic Role Assignment</h2>

        <div class="component-box">
            <h3>Simple Role Format</h3>
            <div class="code-block">
                <pre>You are a [ROLE]. [TASK/QUESTION]</pre>
            </div>
            <div class="example">
                <strong>Example:</strong> "You are a marketing manager. Create a social media strategy for a new coffee shop."
            </div>
        </div>

        <h2>🔧 Types of Roles</h2>

        <div class="comparison">
            <div class="good-example">
                <h4>✅ Professional Roles</h4>
                <ul>
                    <li>You are a financial advisor...</li>
                    <li>You are a software engineer...</li>
                    <li>You are a teacher...</li>
                    <li>You are a doctor...</li>
                </ul>
            </div>
            
            <div class="good-example">
                <h4>✅ Expertise Areas</h4>
                <ul>
                    <li>You are an expert in cybersecurity...</li>
                    <li>You are a specialist in data analysis...</li>
                    <li>You are a consultant for small businesses...</li>
                    <li>You are an authority on renewable energy...</li>
                </ul>
            </div>
        </div>

        <div class="comparison">
            <div class="good-example">
                <h4>✅ Character Types</h4>
                <ul>
                    <li>You are a helpful tutor...</li>
                    <li>You are a creative writer...</li>
                    <li>You are a critical reviewer...</li>
                    <li>You are a supportive coach...</li>
                </ul>
            </div>
            
            <div class="good-example">
                <h4>✅ Perspective Roles</h4>
                <ul>
                    <li>You are a customer evaluating...</li>
                    <li>You are a beginner learning...</li>
                    <li>You are a manager reviewing...</li>
                    <li>You are an investor considering...</li>
                </ul>
            </div>
        </div>

        <h2>⚡ Enhanced Role Prompting</h2>

        <p>For even better results, provide more context about the role:</p>

        <div class="component-box">
            <h3>Detailed Role Format</h3>
            <div class="code-block">
                <pre>You are a [ROLE] with [EXPERIENCE/BACKGROUND]. 
Your expertise includes [SPECIFIC SKILLS/KNOWLEDGE].
Your approach is [STYLE/METHODOLOGY].

[TASK/QUESTION]</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Example: Enhanced Role</h3>
            <div class="code-block">
                <pre>You are a senior UX designer with 8 years of experience in e-commerce.
Your expertise includes user research, conversion optimization, and accessibility.
Your approach is data-driven and user-centered.

Review this checkout page design and provide improvement recommendations.</pre>
            </div>
        </div>

        <h2>🎯 Role Prompting Examples</h2>

        <div class="comparison-exercise">
            <div class="prompt-option">
                <h4>Without Role</h4>
                <div class="code-block">
                    <pre>How can I improve my website's performance?</pre>
                </div>
                <small>Generic, broad response</small>
            </div>
            
            <div class="prompt-option">
                <h4>With Role</h4>
                <div class="code-block">
                    <pre>You are a web performance specialist with expertise in Core Web Vitals optimization. 

How can I improve my e-commerce website's performance to reduce bounce rate and increase conversions?</pre>
                </div>
                <small>Specific, technical, actionable response</small>
            </div>
        </div>

        <h2>🎨 Creative Role Applications</h2>

        <div class="component-box">
            <h3>Multiple Perspectives</h3>
            <p>Ask Claude to consider multiple roles for comprehensive analysis:</p>
            <div class="example">
                "Analyze this business idea from three perspectives: as a potential customer, as an investor, and as a competitor."
            </div>
        </div>

        <div class="component-box">
            <h3>Role Evolution</h3>
            <p>Change roles within a conversation for different tasks:</p>
            <div class="example">
                "First, as a technical writer, explain this concept simply. Then, as a scientist, provide the technical details."
            </div>
        </div>

        <h2>⚠️ Role Prompting Best Practices</h2>

        <div class="alert alert-info">
            <h3>✅ Do:</h3>
            <ul>
                <li>Be specific about the role's expertise area</li>
                <li>Match the role to your task's requirements</li>
                <li>Provide context about the role's background when helpful</li>
                <li>Use roles consistently throughout a conversation</li>
            </ul>
        </div>

        <div class="alert alert-warning">
            <h3>❌ Avoid:</h3>
            <ul>
                <li>Overly broad roles ("You are an expert in everything")</li>
                <li>Contradictory role assignments in the same prompt</li>
                <li>Roles that might encourage harmful or biased responses</li>
                <li>Assuming the role gives Claude capabilities it doesn't have</li>
            </ul>
        </div>

        <h2>🔍 Role Prompting Patterns</h2>

        <div class="code-block">
            <pre>
<strong>Pattern 1: Expert Consultant</strong>
"You are a [FIELD] consultant with [X] years of experience helping [TARGET CLIENTS]. 
[TASK/QUESTION]"

<strong>Pattern 2: Specific Professional</strong>
"You are a [JOB TITLE] at a [COMPANY TYPE] specializing in [SPECIALTY].
[TASK/QUESTION]"

<strong>Pattern 3: Teaching Role</strong>
"You are a [SUBJECT] tutor helping a [STUDENT LEVEL] student understand [TOPIC].
Explain [CONCEPT] in a way that's easy to understand."

<strong>Pattern 4: Evaluator Role</strong>
"You are a [TYPE] reviewer with expertise in [CRITERIA].
Evaluate this [ITEM] and provide constructive feedback."
            </pre>
        </div>

        <div class="alert alert-success">
            <p><strong>Pro Tip:</strong> The right role can transform a generic response into expert-level advice tailored to your specific needs!</p>
        </div>

        <p>Ready to practice role prompting? Let's move on to the exercises where you'll experiment with different roles and see their impact!</p>
    `
}; 
