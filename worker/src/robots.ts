import robotsParser from 'robots-parser';

export async function checkRobotsTxt(url: string): Promise<boolean> {
  try {
    const urlObj = new URL(url);
    const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
    
    const response = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(20000)
    });
    
    if (!response.ok) {
      // If robots.txt doesn't exist, allow by default
      return true;
    }
    
    const robotsTxt = await response.text();
    
    // Parse robots.txt
    const robots = robotsParser(robotsUrl, robotsTxt);
    
    // Check if crawling is allowed for User-agent: *
    const isAllowed = robots.isAllowed(url, '*');
    
    return isAllowed ?? true; // Default to allowed if undefined
  } catch (error) {
    console.error('Error checking robots.txt:', error);
    // On error, allow by default (be lenient)
    return true;
  }
}
