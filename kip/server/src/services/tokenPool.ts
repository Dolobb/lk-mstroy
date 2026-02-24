export class TokenPool {
  private tokens: string[];
  private index: number = 0;

  constructor(tokens: string[]) {
    if (tokens.length === 0) {
      throw new Error('TokenPool requires at least one token');
    }
    this.tokens = [...tokens];
  }

  next(): string {
    const token = this.tokens[this.index % this.tokens.length];
    this.index++;
    return token;
  }

  get size(): number {
    return this.tokens.length;
  }
}
