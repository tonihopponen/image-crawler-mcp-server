#!/usr/bin/env node

/**
 * MCP Server for SaaS Image Crawling Service
 *
 * This server provides tools to access the AWS Lambda-based image crawling service
 * that extracts and analyzes product images from SaaS websites.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

// Configuration
const LAMBDA_ENDPOINT = process.env.LAMBDA_ENDPOINT || 'https://your-api-gateway-url.amazonaws.com/prod';
const API_KEY = process.env.API_KEY; // Optional API key for authentication

interface ImageResult {
  url: string;
  alt: string;
  landing_page: string;
  hash: string;
}

interface CrawlResponse {
  source_url: string;
  generated_at: string;
  images: ImageResult[];
}

interface CrawlError {
  error: string;
  details?: string;
}

class ImageCrawlerServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'image-crawler',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'crawl_saas_images',
            description: 'Crawl a SaaS website to extract and analyze product images',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'The URL of the SaaS website to crawl (must start with http:// or https://)',
                },
                force_refresh: {
                  type: 'boolean',
                  description: 'Force refresh of cached data (default: false)',
                  default: false,
                },
              },
              required: ['url'],
            },
          },
          {
            name: 'analyze_crawl_results',
            description: 'Analyze and summarize crawling results',
            inputSchema: {
              type: 'object',
              properties: {
                results: {
                  type: 'object',
                  description: 'Raw crawling results from crawl_saas_images',
                },
                focus: {
                  type: 'string',
                  description: 'Analysis focus: "quality", "diversity", "marketing", or "technical"',
                  enum: ['quality', 'diversity', 'marketing', 'technical'],
                  default: 'quality',
                },
              },
              required: ['results'],
            },
          },
          {
            name: 'compare_image_sets',
            description: 'Compare image sets from multiple websites',
            inputSchema: {
              type: 'object',
              properties: {
                website_a: {
                  type: 'object',
                  description: 'Crawling results from first website',
                },
                website_b: {
                  type: 'object',
                  description: 'Crawling results from second website',
                },
                comparison_type: {
                  type: 'string',
                  description: 'Type of comparison to perform',
                  enum: ['quantity', 'quality', 'diversity', 'marketing_effectiveness'],
                  default: 'quality',
                },
              },
              required: ['website_a', 'website_b'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'crawl_saas_images':
            return await this.crawlSaasImages(args);
          case 'analyze_crawl_results':
            return await this.analyzeCrawlResults(args);
          case 'compare_image_sets':
            return await this.compareImageSets(args);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error}`);
      }
    });
  }

  private async crawlSaasImages(args: any) {
    const { url, force_refresh = false } = args;

    if (!url || typeof url !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'URL is required and must be a string');
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid URL format. Must start with http:// or https://');
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (API_KEY) {
        headers['Authorization'] = `Bearer ${API_KEY}`;
      }

      const response = await axios.post<CrawlResponse>(
        LAMBDA_ENDPOINT,
        {
          url,
          force_refresh,
        },
        {
          headers,
          timeout: 120000, // 2 minutes timeout
        }
      );

      const data = response.data;

      return {
        content: [
          {
            type: 'text',
            text: `Successfully crawled ${data.source_url}

**Summary:**
- Found ${data.images.length} product images
- Generated at: ${data.generated_at}
- Force refresh: ${force_refresh}

**Images:**
${data.images.map((img, i) => `
${i + 1}. **${img.alt || 'No alt text'}**
   - URL: ${img.url}
   - Landing page: ${img.landing_page}
   - Hash: ${img.hash}
`).join('')}

**Raw Data:**
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\``,
          },
        ],
      };
    } catch (error: any) {
      if (error.response?.status === 400) {
        const errorData = error.response.data as CrawlError;
        throw new McpError(
          ErrorCode.InvalidParams,
          `Crawling failed: ${errorData.error}${errorData.details ? `\nDetails: ${errorData.details}` : ''}`
        );
      }

      throw new McpError(
        ErrorCode.InternalError,
        `Failed to crawl website: ${error.message}`
      );
    }
  }

  private async analyzeCrawlResults(args: any) {
    const { results, focus = 'quality' } = args;

    if (!results || !results.images) {
      throw new McpError(ErrorCode.InvalidParams, 'Results object with images array is required');
    }

    const images: ImageResult[] = results.images;
    const sourceUrl = results.source_url || 'Unknown';

    let analysis = '';

    switch (focus) {
      case 'quality':
        analysis = this.analyzeImageQuality(images, sourceUrl);
        break;
      case 'diversity':
        analysis = this.analyzeImageDiversity(images, sourceUrl);
        break;
      case 'marketing':
        analysis = this.analyzeMarketingEffectiveness(images, sourceUrl);
        break;
      case 'technical':
        analysis = this.analyzeTechnicalAspects(images, sourceUrl);
        break;
      default:
        throw new McpError(ErrorCode.InvalidParams, 'Invalid focus type');
    }

    return {
      content: [
        {
          type: 'text',
          text: analysis,
        },
      ],
    };
  }

  private async compareImageSets(args: any) {
    const { website_a, website_b, comparison_type = 'quality' } = args;

    if (!website_a?.images || !website_b?.images) {
      throw new McpError(ErrorCode.InvalidParams, 'Both websites must have images arrays');
    }

    const imagesA: ImageResult[] = website_a.images;
    const imagesB: ImageResult[] = website_b.images;
    const urlA = website_a.source_url || 'Website A';
    const urlB = website_b.source_url || 'Website B';

    let comparison = '';

    switch (comparison_type) {
      case 'quantity':
        comparison = this.compareQuantity(imagesA, imagesB, urlA, urlB);
        break;
      case 'quality':
        comparison = this.compareQuality(imagesA, imagesB, urlA, urlB);
        break;
      case 'diversity':
        comparison = this.compareDiversity(imagesA, imagesB, urlA, urlB);
        break;
      case 'marketing_effectiveness':
        comparison = this.compareMarketingEffectiveness(imagesA, imagesB, urlA, urlB);
        break;
      default:
        throw new McpError(ErrorCode.InvalidParams, 'Invalid comparison type');
    }

    return {
      content: [
        {
          type: 'text',
          text: comparison,
        },
      ],
    };
  }

  private analyzeImageQuality(images: ImageResult[], sourceUrl: string): string {
    const totalImages = images.length;
    const imagesWithAlt = images.filter(img => img.alt && img.alt.trim().length > 0).length;
    const altTextQuality = images.map(img => img.alt?.length || 0);
    const avgAltLength = altTextQuality.reduce((a, b) => a + b, 0) / totalImages;

    return `# Image Quality Analysis for ${sourceUrl}

## Overview
- **Total Images**: ${totalImages}
- **Images with Alt Text**: ${imagesWithAlt} (${((imagesWithAlt / totalImages) * 100).toFixed(1)}%)
- **Average Alt Text Length**: ${avgAltLength.toFixed(1)} characters

## Alt Text Quality
${images.map((img, i) => `
### Image ${i + 1}
- **URL**: ${img.url}
- **Alt Text Length**: ${img.alt?.length || 0} characters
- **Quality Score**: ${this.scoreAltText(img.alt)} / 10
- **Alt Text**: ${img.alt || 'No alt text provided'}
`).join('')}

## Recommendations
${this.getQualityRecommendations(images)}`;
  }

  private analyzeImageDiversity(images: ImageResult[], sourceUrl: string): string {
    const uniqueHashes = new Set(images.map(img => img.hash)).size;
    const uniqueUrls = new Set(images.map(img => img.url)).size;
    const diversityScore = (uniqueHashes / images.length) * 100;

    return `# Image Diversity Analysis for ${sourceUrl}

## Diversity Metrics
- **Total Images**: ${images.length}
- **Unique Hashes**: ${uniqueHashes}
- **Unique URLs**: ${uniqueUrls}
- **Diversity Score**: ${diversityScore.toFixed(1)}%

## Analysis
${diversityScore > 90 ? '✅ Excellent diversity - very few duplicate images' :
  diversityScore > 70 ? '⚠️ Good diversity - some duplicate images detected' :
  '❌ Poor diversity - many duplicate images detected'}

## Image Sources
${images.map((img, i) => `
${i + 1}. Landing Page: ${img.landing_page}
   Hash: ${img.hash}
`).join('')}`;
  }

  private analyzeMarketingEffectiveness(images: ImageResult[], sourceUrl: string): string {
    const marketingKeywords = ['dashboard', 'interface', 'analytics', 'report', 'chart', 'graph', 'widget', 'feature', 'tool', 'platform'];
    const marketingScores = images.map(img => {
      const altText = (img.alt || '').toLowerCase();
      const keywordMatches = marketingKeywords.filter(keyword => altText.includes(keyword)).length;
      return { img, score: keywordMatches, matches: keywordMatches };
    });

    const avgScore = marketingScores.reduce((a, b) => a + b.score, 0) / images.length;

    return `# Marketing Effectiveness Analysis for ${sourceUrl}

## Marketing Score: ${avgScore.toFixed(1)} / ${marketingKeywords.length}

## Individual Image Analysis
${marketingScores.map((item, i) => `
### Image ${i + 1}
- **Marketing Score**: ${item.score} / ${marketingKeywords.length}
- **URL**: ${item.img.url}
- **Alt Text**: ${item.img.alt || 'No alt text'}
- **Assessment**: ${item.score > 2 ? '✅ Strong marketing language' :
  item.score > 0 ? '⚠️ Some marketing elements' :
  '❌ Weak marketing language'}
`).join('')}

## Recommendations
${this.getMarketingRecommendations(marketingScores)}`;
  }

  private analyzeTechnicalAspects(images: ImageResult[], sourceUrl: string): string {
    const s3Images = images.filter(img => img.url.includes('s3.amazonaws.com')).length;
    const webpImages = images.filter(img => img.url.includes('.webp')).length;
    const hashDistribution = images.map(img => img.hash.substring(0, 2));

    return `# Technical Analysis for ${sourceUrl}

## Technical Metrics
- **Total Images**: ${images.length}
- **S3 Hosted Images**: ${s3Images} (${((s3Images / images.length) * 100).toFixed(1)}%)
- **WebP Format**: ${webpImages} (${((webpImages / images.length) * 100).toFixed(1)}%)
- **Hash Diversity**: ${new Set(hashDistribution).size} unique prefixes

## Image Processing Pipeline
${s3Images > 0 ? '✅ Images processed through S3 pipeline' : '❌ No S3 processing detected'}
${webpImages > 0 ? '✅ Modern WebP format in use' : '⚠️ No WebP format detected'}

## URLs
${images.map((img, i) => `
${i + 1}. ${img.url}
   Hash: ${img.hash}
   Format: ${this.getImageFormat(img.url)}
`).join('')}`;
  }

  private compareQuantity(imagesA: ImageResult[], imagesB: ImageResult[], urlA: string, urlB: string): string {
    return `# Quantity Comparison

## Results
- **${urlA}**: ${imagesA.length} images
- **${urlB}**: ${imagesB.length} images
- **Difference**: ${Math.abs(imagesA.length - imagesB.length)} images

## Winner
${imagesA.length > imagesB.length ? `🏆 ${urlA} (${imagesA.length} images)` :
  imagesB.length > imagesA.length ? `🏆 ${urlB} (${imagesB.length} images)` :
  '🤝 Tie - equal number of images'}`;
  }

  private compareQuality(imagesA: ImageResult[], imagesB: ImageResult[], urlA: string, urlB: string): string {
    const qualityA = this.calculateOverallQuality(imagesA);
    const qualityB = this.calculateOverallQuality(imagesB);

    return `# Quality Comparison

## Quality Scores
- **${urlA}**: ${qualityA.toFixed(1)} / 10
- **${urlB}**: ${qualityB.toFixed(1)} / 10
- **Difference**: ${Math.abs(qualityA - qualityB).toFixed(1)} points

## Winner
${qualityA > qualityB ? `🏆 ${urlA} (${qualityA.toFixed(1)} / 10)` :
  qualityB > qualityA ? `🏆 ${urlB} (${qualityB.toFixed(1)} / 10)` :
  '🤝 Tie - equal quality scores'}`;
  }

  private compareDiversity(imagesA: ImageResult[], imagesB: ImageResult[], urlA: string, urlB: string): string {
    const diversityA = (new Set(imagesA.map(img => img.hash)).size / imagesA.length) * 100;
    const diversityB = (new Set(imagesB.map(img => img.hash)).size / imagesB.length) * 100;

    return `# Diversity Comparison

## Diversity Scores
- **${urlA}**: ${diversityA.toFixed(1)}%
- **${urlB}**: ${diversityB.toFixed(1)}%
- **Difference**: ${Math.abs(diversityA - diversityB).toFixed(1)}%

## Winner
${diversityA > diversityB ? `🏆 ${urlA} (${diversityA.toFixed(1)}%)` :
  diversityB > diversityA ? `🏆 ${urlB} (${diversityB.toFixed(1)}%)` :
  '🤝 Tie - equal diversity scores'}`;
  }

  private compareMarketingEffectiveness(imagesA: ImageResult[], imagesB: ImageResult[], urlA: string, urlB: string): string {
    const marketingA = this.calculateMarketingScore(imagesA);
    const marketingB = this.calculateMarketingScore(imagesB);

    return `# Marketing Effectiveness Comparison

## Marketing Scores
- **${urlA}**: ${marketingA.toFixed(1)} / 10
- **${urlB}**: ${marketingB.toFixed(1)} / 10
- **Difference**: ${Math.abs(marketingA - marketingB).toFixed(1)} points

## Winner
${marketingA > marketingB ? `🏆 ${urlA} (${marketingA.toFixed(1)} / 10)` :
  marketingB > marketingA ? `🏆 ${urlB} (${marketingB.toFixed(1)} / 10)` :
  '🤝 Tie - equal marketing effectiveness'}`;
  }

  // Helper methods
  private scoreAltText(altText?: string): number {
    if (!altText) return 0;
    const length = altText.length;
    if (length < 10) return 2;
    if (length < 30) return 4;
    if (length < 60) return 6;
    if (length < 100) return 8;
    return 10;
  }

  private calculateOverallQuality(images: ImageResult[]): number {
    return images.reduce((sum, img) => sum + this.scoreAltText(img.alt), 0) / images.length;
  }

  private calculateMarketingScore(images: ImageResult[]): number {
    const marketingKeywords = ['dashboard', 'interface', 'analytics', 'report', 'chart', 'graph', 'widget', 'feature', 'tool', 'platform'];
    const totalScore = images.reduce((sum, img) => {
      const altText = (img.alt || '').toLowerCase();
      const keywordMatches = marketingKeywords.filter(keyword => altText.includes(keyword)).length;
      return sum + keywordMatches;
    }, 0);
    return (totalScore / images.length) * 2; // Scale to 0-10
  }

  private getImageFormat(url: string): string {
    if (url.includes('.webp')) return 'WebP';
    if (url.includes('.jpg') || url.includes('.jpeg')) return 'JPEG';
    if (url.includes('.png')) return 'PNG';
    if (url.includes('.gif')) return 'GIF';
    if (url.includes('.svg')) return 'SVG';
    return 'Unknown';
  }

  private getQualityRecommendations(images: ImageResult[]): string {
    const recommendations = [];

    const noAltText = images.filter(img => !img.alt || img.alt.trim().length === 0).length;
    if (noAltText > 0) {
      recommendations.push(`- Add alt text to ${noAltText} images`);
    }

    const shortAltText = images.filter(img => img.alt && img.alt.length < 30).length;
    if (shortAltText > 0) {
      recommendations.push(`- Improve alt text for ${shortAltText} images (too short)`);
    }

    if (recommendations.length === 0) {
      recommendations.push('- All images have good quality alt text');
    }

    return recommendations.join('\n');
  }

  private getMarketingRecommendations(marketingScores: any[]): string {
    const recommendations = [];

    const weakMarketing = marketingScores.filter(item => item.score === 0).length;
    if (weakMarketing > 0) {
      recommendations.push(`- ${weakMarketing} images need stronger marketing language`);
    }

    const avgScore = marketingScores.reduce((a, b) => a + b.score, 0) / marketingScores.length;
    if (avgScore < 1) {
      recommendations.push('- Overall marketing effectiveness is low');
      recommendations.push('- Consider adding more product-focused keywords');
    }

    if (recommendations.length === 0) {
      recommendations.push('- Marketing effectiveness is good');
    }

    return recommendations.join('\n');
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Image Crawler MCP server running on stdio');
  }
}

const server = new ImageCrawlerServer();
server.run().catch(console.error);
