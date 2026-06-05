const { buildBrochureHtml } = require('./pdf/buildBrochureHtml');
const { renderPdfBuffer } = require('./pdf/renderPdfBuffer');
const fs = require('fs');

(async () => {
  try {
    console.log('Building HTML...');
    const html = await buildBrochureHtml({
      products: [{id:1,name:'Test',category:'Cat',size:'M',price:100,image:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}],
      maxPerPage: 6,
      coverTitle: 'TEST',
      logoUrl: './assets/logo.png'
    });
    console.log('HTML generated, length:', html.length);
    
    console.log('Rendering PDF...');
    const pdf = await renderPdfBuffer({ html });
    console.log('PDF generated, length:', pdf.length);
    
    fs.writeFileSync('/tmp/test-with-logo.pdf', pdf);
    console.log('PDF saved to /tmp/test-with-logo.pdf');
  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
