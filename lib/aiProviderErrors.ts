/** Provider responses may echo credentials. Only these classifications leave the server. */
export function classifyAiProviderError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/CONSUMER_SUSPENDED|consumer.*suspend/i.test(message)) return { code: 'PROVIDER_SUSPENDED', retryable: false, message: 'AI provider access is suspended. Restore the configured Google API consumer before generating again.' };
    if (/401|403|PERMISSION_DENIED|api.?key.*(?:invalid|expired)|unauthenticated/i.test(message)) return { code: 'PROVIDER_AUTH_FAILED', retryable: false, message: 'AI provider access was rejected. Check the configured service credentials and permissions.' };
    if (/not configured|missing.*key/i.test(message)) return { code: 'PROVIDER_NOT_CONFIGURED', retryable: false, message: 'AI generation is not configured on the server.' };
    if (/429|resource_exhausted|quota/i.test(message)) return { code: 'PROVIDER_QUOTA_EXHAUSTED', retryable: false, message: 'AI provider quota is exhausted. Wait for the quota reset or review the provider account.' };
    if (/timeout|abort/i.test(message)) return { code: 'PROVIDER_TIMEOUT', retryable: true, message: 'AI generation timed out. Your existing description has been kept.' };
    return { code: 'PROVIDER_UNAVAILABLE', retryable: true, message: 'AI generation is unavailable. Your existing description has been kept.' };
}
export function sanitizeAiWarning(warning: string): string {
    if (/Image analysis failed:|AI repair was unavailable|AIza[\w-]+|api[_ -]?key:|CONSUMER_SUSPENDED|PERMISSION_DENIED/i.test(warning)) return classifyAiProviderError(warning).message;
    return warning;
}
