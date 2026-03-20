<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
<xsl:output method="html" encoding="UTF-8" indent="yes"/>
<xsl:template match="/">
<html>
<head>
  <title>Sitemap — medicare-california.com</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; background: #f8f9fa; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: .25rem; color: #1a1a2e; }
    p.meta { color: #666; font-size: .875rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    th { background: #1a1a2e; color: #fff; text-align: left; padding: .75rem 1rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; }
    td { padding: .6rem 1rem; font-size: .85rem; border-bottom: 1px solid #eee; }
    tr:hover td { background: #f0f4ff; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .priority { text-align: center; }
    .high { color: #16a34a; font-weight: 600; }
    .med { color: #ca8a04; }
    .low { color: #999; }
    .hreflang { font-size: .75rem; color: #888; }
  </style>
</head>
<body>
  <h1>XML Sitemap</h1>
  <p class="meta">medicare-california.com — <xsl:value-of select="count(sitemap:urlset/sitemap:url)"/> URLs</p>
  <table>
    <tr>
      <th>#</th>
      <th>URL</th>
      <th>Hreflang</th>
      <th>Last Modified</th>
      <th>Frequency</th>
      <th>Priority</th>
    </tr>
    <xsl:for-each select="sitemap:urlset/sitemap:url">
      <tr>
        <td><xsl:value-of select="position()"/></td>
        <td><a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a></td>
        <td class="hreflang">
          <xsl:for-each select="xhtml:link[@rel='alternate']">
            <xsl:value-of select="@hreflang"/>
            <xsl:if test="position() != last()">, </xsl:if>
          </xsl:for-each>
        </td>
        <td><xsl:value-of select="sitemap:lastmod"/></td>
        <td><xsl:value-of select="sitemap:changefreq"/></td>
        <td class="priority">
          <xsl:choose>
            <xsl:when test="sitemap:priority &gt;= 0.8"><span class="high"><xsl:value-of select="sitemap:priority"/></span></xsl:when>
            <xsl:when test="sitemap:priority &gt;= 0.5"><span class="med"><xsl:value-of select="sitemap:priority"/></span></xsl:when>
            <xsl:otherwise><span class="low"><xsl:value-of select="sitemap:priority"/></span></xsl:otherwise>
          </xsl:choose>
        </td>
      </tr>
    </xsl:for-each>
  </table>
</body>
</html>
</xsl:template>
</xsl:stylesheet>
