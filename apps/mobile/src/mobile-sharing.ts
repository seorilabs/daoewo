import type {DaoewoSharing} from '@daoewo/product-ui';
import {Share} from 'react-native';

interface ShareApi {
  share(content: {readonly title: string; readonly message: string}): Promise<unknown>;
}

export function createMobileSharingAdapter(
  shareApi: ShareApi = Share,
): DaoewoSharing {
  return {
    availability: 'available',
    async shareText(input) {
      if (input.message.trim().length === 0) {
        throw new Error('공유할 내용이 비어 있어요.');
      }
      await shareApi.share({title: input.title, message: input.message});
    },
  };
}
