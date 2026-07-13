import {createMobileSharingAdapter} from '../src/mobile-sharing';

describe('mobile sharing adapter', () => {
  it('title과 message를 React Native Share API에 그대로 전달한다', async () => {
    const share = jest.fn().mockResolvedValue({action: 'sharedAction'});
    const sharing = createMobileSharingAdapter({share});

    await expect(
      sharing.shareText({title: '다외워 학습 데이터', message: '{"version":1}'}),
    ).resolves.toBeUndefined();

    expect(sharing.availability).toBe('available');
    expect(share).toHaveBeenCalledWith({
      title: '다외워 학습 데이터',
      message: '{"version":1}',
    });
  });

  it('빈 message는 native share sheet 호출 전에 거부한다', async () => {
    const share = jest.fn().mockResolvedValue({});
    const sharing = createMobileSharingAdapter({share});

    await expect(
      sharing.shareText({title: '제목', message: ' \n '}),
    ).rejects.toThrow('비어');
    expect(share).not.toHaveBeenCalled();
  });
});
