import { generateText, type FilePart, type ImagePart, type ModelMessage, type TextPart } from 'ai'
import type { ProviderResolver } from '../llm'
import type { ChatContentItem, ChatRequest, ChatResponseLike, SemanticChatClient } from './types'

type UserContentPart = TextPart | ImagePart | FilePart

function inferVideoMediaType(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;]+);/)
  if (match) return match[1]
  return 'video/mp4'
}

function translatePart(part: ChatContentItem): UserContentPart {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text }
    case 'image_url':
      return { type: 'image', image: part.imageUrl.url }
    case 'input_video':
      return {
        type: 'file',
        data: part.videoUrl.url,
        mediaType: inferVideoMediaType(part.videoUrl.url),
      }
  }
}

function translateMessages(messages: ChatRequest['messages']): ModelMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map(translatePart),
  }))
}

export function createAISDKChatClient(resolver: ProviderResolver): SemanticChatClient {
  return {
    chat: {
      send: async (request: ChatRequest): Promise<ChatResponseLike> => {
        const model = resolver.buildActive(request.model)
        const messages = translateMessages(request.messages)
        const result = await generateText({ model, messages })
        return {
          choices: [{ message: { content: result.text } }],
          usage: {
            promptTokens: result.usage?.inputTokens,
            completionTokens: result.usage?.outputTokens,
          },
        }
      },
    },
  }
}
