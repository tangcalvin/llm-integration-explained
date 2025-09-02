import { useMemo, useState } from 'react'
import './App.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type OpenAIMessage = {
	rule: 'system' | 'user' | 'assistant'
	content: string
}

type OpenAIChatRequest = {
	model: string
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
	temperature?: number
	max_tokens?: number
}

type OpenAIChatChoice = {
	index: number
	message: { role: 'assistant'; content: string }
	finish_reason: string
}

type OpenAIChatResponse = {
	id: string
	object: string
	created: number
	model: string
	choices: OpenAIChatChoice[]
	usage?: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
	}
}

// DeepSeek Model
const DEFAULT_MODEL = 'deepseek-chat'
const API_URL = '/qwen-api/deepseek/single-prompt'
const FETCH_TIMEOUT_MS = 120000

function extractAssistantText(data: unknown): string {
	try {
		// 1) OpenAI Chat Completions
		const asOpenAI = data as Partial<OpenAIChatResponse>
		const openAiText = asOpenAI?.choices?.[0]?.message?.content
		if (typeof openAiText === 'string' && openAiText.length > 0) return openAiText

		// 2) { output: { content: string } }
		const asOutput = data as { output?: { content?: string } }
		if (typeof asOutput?.output?.content === 'string' && asOutput.output.content.length > 0) {
			return asOutput.output.content
		}

		// 3) { data: { choices: [{ message: { content: string } }] } } (some wrappers)
		const nested = data as { data?: { choices?: Array<{ message?: { content?: string } }> } }
		const nestedContent = nested?.data?.choices?.[0]?.message?.content
		if (typeof nestedContent === 'string' && nestedContent.length > 0) return nestedContent

		// 4) Fallback to stringified
		return ''
	} catch {
		return ''
	}
}

function unescapeNewlinesAndTabs(value: string | undefined | null): string {
	if (!value) return ''
	return value
		.replace(/\\r\\n/g, '\n')
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '    ')
}

function App() {
	const [prompt, setPrompt] = useState('Explain how transformers process tokens in simple terms.')
	const [assistantText, setAssistantText] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [rawResponse, setRawResponse] = useState<unknown>(null)
	const [responseView, setResponseView] = useState<'json' | 'content'>('json')

	const requestPayload: OpenAIChatRequest = useMemo(
		() => ({
			model: DEFAULT_MODEL,
			messages: [
				{ role: 'system', content: 'You are a helpful assistant.' },
				{ role: 'user', content: prompt },
			],
		}),
		[prompt]
	)

	const responseJsonString = useMemo(() => {
		if (!rawResponse) return '—'
		try {
			return JSON.stringify(rawResponse, null, 2)
		} catch {
			return String(rawResponse)
		}
	}, [rawResponse])

	const outputContentUnescaped = useMemo(() => {
		try {
			const asOutput = rawResponse as { output?: { content?: string } } | null
			return unescapeNewlinesAndTabs(asOutput?.output?.content)
		} catch {
			return ''
		}
	}, [rawResponse])

	async function handleSend() {
		setLoading(true)
		setError(null)
		setAssistantText('')
		setRawResponse(null)
		try {
			const controller = new AbortController()
			const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

			const response = await fetch(API_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestPayload),
				signal: controller.signal,
			})

			clearTimeout(timer)

			if (!response.ok) {
				const text = await response.text()
				throw new Error(`HTTP ${response.status}: ${text}`)
			}

			const data = await response.json()
			setRawResponse(data)
			const content = extractAssistantText(data)
			setAssistantText(content)
		} catch (e: unknown) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				setError(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`)
			} else {
				const message = e instanceof Error ? e.message : 'Unknown error'
				setError(message)
			}
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="app-root">
			<header className="app-header">
				<h1>LLM - Behind the Prompt</h1>
				<p className="subtitle">Explore how prompts map to actual API requests and responses.</p>
			</header>

			<div className="split-layout">
				<section className="panel left-panel">
					<h2 className="panel-title">Prompt & Response</h2>

					<label className="field-label" htmlFor="prompt">Prompt</label>
					<textarea
						id="prompt"
						className="textarea"
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="Ask a question or give an instruction..."
						rows={10}
					/>

					<div className="controls-row">
						<div className="spacer" />
						<button className="primary-btn" onClick={handleSend} disabled={loading || !prompt.trim()}>
							{loading ? 'Sending…' : 'Send'}
						</button>
					</div>

					{error && <div className="error-box">{error}</div>}

					<label className="field-label" htmlFor="response">Assistant</label>
					<div id="response" className="response-box markdown">
						{assistantText
							? <ReactMarkdown remarkPlugins={[remarkGfm]}>{assistantText}</ReactMarkdown>
							: (loading ? 'Waiting for response…' : '—')}
					</div>
				</section>

				<section className="panel right-panel">
					<h2 className="panel-title">HTTP Details</h2>

					<div className="kv">
						<div className="kv-row"><span className="k">Method</span><span className="v">POST</span></div>
						<div className="kv-row"><span className="k">URL</span><span className="v">{API_URL}</span></div>
						<div className="kv-row"><span className="k">Content-Type</span><span className="v">application/json</span></div>
					</div>

					<div className="json-section">
						<h3 className="json-title">Request payload</h3>
						<pre className="code-block">{JSON.stringify(requestPayload, null, 2)}</pre>
					</div>

					<div className="json-section">
						<div className="json-header">
							<h3 className="json-title">Response</h3>
							<div className="toggle-container">
								<span className="toggle-label">JSON</span>
								<label className="toggle-switch">
									<input
										type="checkbox"
										checked={responseView === 'content'}
										onChange={(e) => setResponseView(e.target.checked ? 'content' : 'json')}
									/>
									<span className="toggle-slider"></span>
								</label>
								<span className="toggle-label">Content</span>
							</div>
						</div>
						<pre className="code-block">
							{responseView === 'json' ? responseJsonString : (outputContentUnescaped || '—')}
						</pre>
					</div>
				</section>
			</div>
		</div>
	)
}

export default App
