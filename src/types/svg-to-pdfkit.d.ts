declare module "svg-to-pdfkit" {
  function SVGtoPDF(doc: PDFKit.PDFDocument, svg: string, x?: number, y?: number, options?: Record<string, unknown>): void;
  export default SVGtoPDF;
}
