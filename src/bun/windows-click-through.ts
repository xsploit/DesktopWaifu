import { dlopen, FFIType, type Pointer } from 'bun:ffi';

const GWL_EXSTYLE = -20;
const WS_EX_TRANSPARENT = 0x00000020;
const WS_EX_LAYERED = 0x00080000;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;

const user32 =
	process.platform === 'win32'
		? dlopen('user32.dll', {
				GetWindowLongW: {
					args: [FFIType.ptr, FFIType.i32],
					returns: FFIType.i32,
				},
				SetWindowLongW: {
					args: [FFIType.ptr, FFIType.i32, FFIType.i32],
					returns: FFIType.i32,
				},
				SetWindowPos: {
					args: [
						FFIType.ptr,
						FFIType.ptr,
						FFIType.i32,
						FFIType.i32,
						FFIType.i32,
						FFIType.i32,
						FFIType.u32,
					],
					returns: FFIType.bool,
				},
			})
		: null;

export function setWindowClickThrough(windowPtr: Pointer, enabled: boolean) {
	if (!user32) {
		return false;
	}

	const currentExStyle = user32.symbols.GetWindowLongW(windowPtr, GWL_EXSTYLE);
	const nextExStyle = enabled
		? currentExStyle | WS_EX_TRANSPARENT | WS_EX_LAYERED
		: (currentExStyle | WS_EX_LAYERED) & ~WS_EX_TRANSPARENT;

	user32.symbols.SetWindowLongW(windowPtr, GWL_EXSTYLE, nextExStyle);
	user32.symbols.SetWindowPos(
		windowPtr,
		null,
		0,
		0,
		0,
		0,
		SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
	);

	return true;
}
