export const lesson7 = {
    id: 'lesson-7',
    title: 'Lesson 7: Using Examples (Few-Shot Prompting)',
    content: `
        <h1>Lesson 7: Using Examples (Few-Shot Prompting)</h1>
        
        <p>Few-shot prompting is one of the most powerful techniques in prompt engineering. By providing examples of the desired input-output pattern, you can guide Claude to understand exactly what you want, even for complex or nuanced tasks.</p>

        <h2>🎯 What is Few-Shot Prompting?</h2>
        
        <p>Few-shot prompting means providing a few examples of the task you want Claude to perform, showing both the input and the expected output. This helps Claude understand:</p>
        <ul>
            <li>The exact format you want</li>
            <li>The style and tone to use</li>
            <li>The level of detail expected</li>
            <li>How to handle edge cases</li>
        </ul>

        <div class="alert alert-info">
            <p><strong>Why examples work:</strong> Humans learn by example, and so do AI models. Examples provide concrete patterns that are often clearer than abstract instructions.</p>
        </div>

        <h2>🔧 Basic Few-Shot Structure</h2>

        <div class="component-box">
            <h3>Standard Pattern</h3>
            <div class="code-block">
                <pre>Here are some examples of [task]:

Example 1:
Input: [example input 1]
Output: [example output 1]

Example 2:
Input: [example input 2]
Output: [example output 2]

Now please do the same for:
Input: [your actual input]
Output:</pre>
            </div>
        </div>

        <h2>🎨 Types of Few-Shot Examples</h2>

        <div class="comparison">
            <div class="poor-example">
                <h4>❌ No Examples (Zero-Shot)</h4>
                <div class="code-block">
                    <pre>Write a professional email response to a customer complaint.</pre>
                </div>
                <small>Vague - could produce many different styles</small>
            </div>
            
            <div class="good-example">
                <h4>✅ Few-Shot with Examples</h4>
                <div class="code-block">
                    <pre>Write professional email responses to customer complaints. Here are examples:

Example 1:
Complaint: "My order arrived late and damaged."
Response: "Dear [Name], I sincerely apologize for the delay and damage to your order. We're processing a full refund and expediting a replacement at no charge. I've also added a 20% discount to your account for the inconvenience. Thank you for your patience."

Example 2:
Complaint: "The product doesn't work as advertised."
Response: "Dear [Name], Thank you for bringing this to our attention. I understand your frustration when a product doesn't meet expectations. We'd like to offer you a full refund or exchange, plus complimentary return shipping. Our team will also review the product description to ensure accuracy."

Now write a response to:
Complaint: "Your customer service team was rude to me on the phone."</pre>
                </div>
                <small>Clear pattern for tone, structure, and content</small>
            </div>
        </div>

        <h2>🎯 Few-Shot Applications</h2>

        <div class="component-box">
            <h3>Data Extraction</h3>
            <div class="code-block">
                <pre>Extract key information from job postings in this format:

Example 1:
Job Posting: "Senior Developer needed at TechCorp. 5+ years experience. Remote OK. $120K-$150K. Apply by March 15."
Extracted Info: {
  "title": "Senior Developer",
  "company": "TechCorp", 
  "experience": "5+ years",
  "location": "Remote",
  "salary": "$120K-$150K",
  "deadline": "March 15"
}

Example 2:
Job Posting: "Marketing Manager position at StartupXYZ in San Francisco. MBA preferred. Competitive salary."
Extracted Info: {
  "title": "Marketing Manager",
  "company": "StartupXYZ",
  "experience": "MBA preferred",
  "location": "San Francisco", 
  "salary": "Competitive",
  "deadline": "Not specified"
}</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Text Classification</h3>
            <div class="code-block">
                <pre>Classify customer feedback sentiment:

Example 1:
Feedback: "Love the new features! App works perfectly now."
Sentiment: Positive
Confidence: High

Example 2:
Feedback: "It's okay, but could be better. Some bugs still exist."
Sentiment: Neutral
Confidence: Medium

Example 3:
Feedback: "Terrible update. App crashes constantly now."
Sentiment: Negative
Confidence: High</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Creative Writing Style</h3>
            <div class="code-block">
                <pre>Write product descriptions in an engaging, benefit-focused style:

Example 1:
Product: Wireless Headphones
Description: "Transform your daily commute into a concert hall. These wireless headphones deliver crystal-clear audio that makes every song feel like a live performance. With 30-hour battery life, you'll never miss a beat of your favorite playlist."

Example 2:
Product: Standing Desk
Description: "Say goodbye to afternoon energy crashes. This adjustable standing desk helps you stay alert and productive all day long. Switch between sitting and standing in seconds, and feel the difference in your focus and posture."</pre>
            </div>
        </div>

        <h2>🔍 Advanced Few-Shot Techniques</h2>

        <div class="component-box">
            <h3>Chain-of-Thought Examples</h3>
            <div class="code-block">
                <pre>Solve math word problems by showing your reasoning:

Example 1:
Problem: "A store offers 20% off, then an additional 10% off the discounted price. What's the final price of a $100 item?"
Solution: 
Step 1: Apply first discount: $100 × 0.8 = $80
Step 2: Apply second discount: $80 × 0.9 = $72
Answer: $72

Example 2:
Problem: "If 3 workers can paint a fence in 4 hours, how long would it take 6 workers?"
Solution:
Step 1: Calculate total work: 3 workers × 4 hours = 12 worker-hours
Step 2: Divide by new workforce: 12 worker-hours ÷ 6 workers = 2 hours
Answer: 2 hours</pre>
            </div>
        </div>

        <div class="component-box">
            <h3>Multi-Step Process Examples</h3>
            <div class="code-block">
                <pre>Analyze business problems using this framework:

Example 1:
Situation: "Restaurant losing customers"
Analysis:
1. Problem: Customer retention declining
2. Possible causes: Food quality, service speed, pricing, competition
3. Data needed: Customer feedback, competitor analysis, operational metrics
4. Recommendation: Survey customers, mystery shop competitors, review kitchen processes
5. Success metric: Customer retention rate improvement

Example 2:
Situation: "E-commerce site has high cart abandonment"
Analysis:
1. Problem: Users not completing purchases
2. Possible causes: Shipping costs, checkout complexity, payment options, trust issues
3. Data needed: Checkout analytics, user session recordings, customer surveys
4. Recommendation: Simplify checkout, offer multiple payment methods, display security badges
5. Success metric: Conversion rate increase</pre>
            </div>
        </div>

        <h2>💡 Example Quality Guidelines</h2>

        <div class="alert alert-success">
            <h3>Good Examples Are:</h3>
            <ul>
                <li><strong>Diverse:</strong> Show different scenarios and edge cases</li>
                <li><strong>Clear:</strong> Unambiguous input-output relationships</li>
                <li><strong>Consistent:</strong> Follow the same format and style</li>
                <li><strong>Representative:</strong> Cover the range of expected inputs</li>
                <li><strong>Complete:</strong> Show the full desired output format</li>
            </ul>
        </div>

        <div class="alert alert-warning">
            <h3>Avoid These Example Mistakes:</h3>
            <ul>
                <li>❌ Too few examples (usually need 2-5)</li>
                <li>❌ Examples that are too similar to each other</li>
                <li>❌ Inconsistent formatting between examples</li>
                <li>❌ Examples that don't match your actual use case</li>
                <li>❌ Overly complex examples that confuse the pattern</li>
            </ul>
        </div>

        <h2>🎯 Choosing the Right Number of Examples</h2>

        <div class="component-box">
            <h3>One-Shot (1 example)</h3>
            <div class="example">
                <strong>Use when:</strong> Simple, straightforward tasks with clear patterns
                <br><strong>Example:</strong> Basic format conversion, simple classification
            </div>
        </div>

        <div class="component-box">
            <h3>Few-Shot (2-5 examples)</h3>
            <div class="example">
                <strong>Use when:</strong> Most complex tasks requiring nuance and style
                <br><strong>Example:</strong> Creative writing, analysis, complex formatting
            </div>
        </div>

        <div class="component-box">
            <h3>Many-Shot (5+ examples)</h3>
            <div class="example">
                <strong>Use when:</strong> Highly specific tasks or when dealing with many edge cases
                <br><strong>Example:</strong> Specialized data extraction, complex classification with many categories
            </div>
        </div>

        <h2>🔄 Combining Few-Shot with Other Techniques</h2>

        <div class="code-block">
            <pre>
<strong>Few-Shot + Role Prompting:</strong>
"As a professional copywriter, write product descriptions following these examples..."

<strong>Few-Shot + Step-by-Step:</strong>
"Analyze these problems step by step, following the pattern shown in these examples..."

<strong>Few-Shot + Output Formatting:</strong>
"Extract data in JSON format, as shown in these examples..."
            </pre>
        </div>

        <p>Examples are incredibly powerful for getting consistent, high-quality outputs. Let's practice creating effective few-shot prompts!</p>
    `
}; 
