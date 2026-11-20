import { getUserFacingErrorMessage } from './errorMessages';

/** Handle both guard failures and asynchronous writes before reporting editor success. */
export function withAdminWriteFeedback<Args extends unknown[]>(write: (...args: Args) => unknown, notify: (message: string) => void) {
  return async (...args: Args): Promise<boolean> => {
    try {
      await write(...args);
      return true;
    } catch (error) {
      notify(getUserFacingErrorMessage(error, 'Changes could not be saved. Reload verified settings and try again.'));
      return false;
    }
  };
}
