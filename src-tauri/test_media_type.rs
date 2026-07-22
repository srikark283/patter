use objc2_foundation::NSString;

#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {
    static AVMediaTypeAudio: *const objc2::runtime::AnyObject;
}

fn main() {
    unsafe {
        let ptr = AVMediaTypeAudio as *const NSString;
        let ns_str = &*ptr;
        println!("AVMediaTypeAudio string: {:?}", ns_str.to_string());
    }
}
