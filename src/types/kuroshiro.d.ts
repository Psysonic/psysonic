declare module 'kuroshiro' {
  export interface KuroshiroConvertOptions {
    mode?: 'normal' | 'spaced' | 'okurigana' | 'furigana';
    to?: 'hiragana' | 'katakana' | 'romaji';
    romajiSystem?: 'nippon' | 'passport' | 'hepburn';
  }

  export interface KuroshiroAnalyzer {
    init(): Promise<void>;
    parse(text: string): Promise<unknown[]>;
  }

  export default class Kuroshiro {
    init(analyzer: KuroshiroAnalyzer): Promise<void>;
    convert(text: string, options?: KuroshiroConvertOptions): Promise<string>;
  }
}
