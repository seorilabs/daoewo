# Core Tests

device, emulator, network, Firebase emulator 없이 실행되는 순수 테스트를 둔다.

`.test.mjs`는 먼저 TypeScript core를 빌드한 뒤 Node test runner로 순수 로직을 실행한다.
따라서 device, emulator, network, SDK가 필요하지 않다.
