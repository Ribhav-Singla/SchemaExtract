export interface Header {
  headerId: number;
  heading: string;
  headingLevel: number;
  lineNumber: number;
}

export interface Section {
  sectionId: number;
  heading: string;
  headingLevel: number;
  content: string;
}

export interface Chunk {
  [key: string]: unknown;
}