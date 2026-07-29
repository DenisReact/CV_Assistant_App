import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
] as const;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MIN_USEFUL_CHARS = 50;

@Injectable()
export class TextExtractionService {
  private readonly logger = new Logger(TextExtractionService.name);

  async extract(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<string> {
    const raw = await this.extractRaw(buffer, mimeType, filename);
    const text = this.normaliseWhitespace(raw);

    if (text.length < MIN_USEFUL_CHARS) {
      throw new UnprocessableEntityException(
        `Could not read any text from "${filename}". If this is a scanned PDF it has no text layer, and would need OCR.`,
      );
    }

    this.logger.debug(`Extracted ${text.length} chars from ${filename}`);

    return text;
  }

  private async extractRaw(
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<string> {
    switch (mimeType) {
      case 'application/pdf':
        return this.extractPdf(buffer);
      case DOCX_MIME:
        return this.extractDocx(buffer);
      case 'text/plain':
      case 'text/markdown':
        return buffer.toString('utf8');
      default:
        throw new UnprocessableEntityException(
          `Unsupported file type "${mimeType}" for "${filename}". Accepted: PDF, DOCX, TXT, Markdown.`,
        );
    }
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  private async extractDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });

    return result.value;
  }

  /**
   * PDF extraction in particular produces ragged output — hard-wrapped lines,
   * runs of spaces from column layout, stray form feeds. Collapsing it makes
   * chunk boundaries predictable, while keeping blank lines because those are
   * the paragraph signal the chunker splits on.
   */
  private normaliseWhitespace(text: string): string {
    return text
      .replace(/\r\n?/g, '\n')
      .replace(/\f/g, '\n\n')
      .replace(/[ \t\u00A0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
