// Languages shown in the left bar. Each one creates a file with a Hello World template.
// These must match the file types supported by server/index.js.
   const logo = (name) => `/lang/${name}.svg`
export const LANGUAGE_LIST = [
  {
    id: 'python', label: 'Python', ext: 'py', base: 'hello', short: 'Py', color: '#3776ab',
    icon: logo('python'),
    template: () => 'print("Hello, World!")\n',
  },
  {
    id: 'javascript', label: 'JavaScript', ext: 'js', base: 'hello', short: 'JS', color: '#d4b106',
    icon: logo('javascript'),
    template: () => 'console.log("Hello, World!");\n',
  },
  {
    id: 'java', label: 'Java', ext: 'java', base: 'Main', short: 'Jv', color: '#e76f00',
    icon: logo('java'),
    // the class name must match the file name, so it is passed in
    template: (cls) =>
      `public class ${cls} {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n`,
  },
  {
    id: 'c', label: 'C', ext: 'c', base: 'hello', short: 'C', color: '#5c6bc0',
    icon: logo('c'),
    template: () =>
      '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, World!\\n");\n    return 0;\n}\n',
  },
  {
    id: 'cpp', label: 'C++', ext: 'cpp', base: 'hello', short: 'C+', color: '#00599c',
    icon: logo('cpp'),
    template: () =>
      '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n',
  },
  {
    id: 'go', label: 'Go', ext: 'go', base: 'hello', short: 'Go', color: '#00add8',
    icon: logo('go'),
    template: () => 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n}\n',
  },
  {
    id: 'rust', label: 'Rust', ext: 'rs', base: 'hello', short: 'Rs', color: '#b7410e',
    icon: logo('rust'),
    template: () => 'fn main() {\n    println!("Hello, World!");\n}\n',
  },
  {
    id: 'ruby', label: 'Ruby', ext: 'rb', base: 'hello', short: 'Rb', color: '#cc342d',
    icon: logo('ruby'),
    template: () => 'puts "Hello, World!"\n',
  },
  {
    id: 'php', label: 'PHP', ext: 'php', base: 'hello', short: 'PHP', color: '#777bb3',
    icon: logo('php'),
    template: () => '<?php\n\necho "Hello, World!\\n";\n',
  },
  {
    id: 'bash', label: 'Bash', ext: 'sh', base: 'hello', short: 'Sh', color: '#4eaa25',
    icon: logo('bash'),
    template: () => '#!/bin/bash\n\necho "Hello, World!"\n',
  },
]
