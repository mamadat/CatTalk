/** Incremental SSE decoding. Handles CRLF and UTF-8 split across network chunks. */
export class SSEParser {
  private pending = '';
  private data: string[] = [];
  private eventSize = 0;
  constructor(private emit: (data: string) => void) {}
  push(chunk: string) {
    this.pending += chunk;
    let end: number;
    while ((end = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0,end).replace(/\r$/, '');
      this.pending = this.pending.slice(end + 1);
      if (!line) {
        if (this.data.length) this.emit(this.data.join('\n'));
        this.data = []; this.eventSize = 0;
      } else if (line.startsWith('data:')) {
        const value = line.slice(5).replace(/^ /, '');
        this.eventSize += value.length;
        if (this.eventSize > 262144) throw new Error('SSE event too large');
        this.data.push(value);
      }
    }
    if (this.pending.length > 262144) throw new Error('SSE line too large');
  }
}
