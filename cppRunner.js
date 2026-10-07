
// CodeSail - C++ Execution Runner



// 1. Import required Node.js modules


const { exec, spawn } = require("child_process"); // Run external processes
const fs = require("fs");                          // File system
const os = require("os");                          // Operating-system utilities
const path = require("path");                      // File path handling


// Maximum output allowed from a program
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1 MB



// 2. Workspace cleanup function


async function cleanupWorkspace(workspace) {

    await fs.promises.rm(workspace, {
        recursive: true,
        force: true
    });

}



//  Main C++ execution function


function runCpp(code, input = "") {

    
    //  Create a unique temporary workspace
   

    const workspace = fs.mkdtempSync(
        path.join(os.tmpdir(), "codesail-")
    );

    console.log("Workspace:", workspace);


  
    // 3.2 Create paths for source code and executable
    

    const sourcePath = path.join(
        workspace,
        "main.cpp"
    );

    const executablePath = path.join(
        workspace,
        "main.exe"
    );


  
    //  Function to finish execution and cleanup workspace
   

    async function finish(result) {

        await cleanupWorkspace(workspace);

        return result;
    }


    
    //  Write student's C++ code into main.cpp
    

    fs.writeFileSync(sourcePath,code);


   
    // 3.5 Return a Promise
   

    return new Promise((resolve) => {


       
        // 4. COMPILE C++ CODE
       

        exec(
            `g++ "${sourcePath}" -o "${executablePath}"`,

            (error, compileStdout, compileStderr) => {


                
                // 4.1 Compilation failed
                

                if (error) {

                    finish({
                        status: "compilation_error",
                        output: "",
                        error: compileStderr
                    }).then(resolve);

                    return;
                }


              
                // 5. EXECUTE COMPILED PROGRAM
               

                const child = spawn(
                    executablePath,[],
                    {
                        cwd: workspace
                    }
                );


               
                // 5.1 Variables for program output
                

                let stdout = "";
                let stderr = "";

                let timedOut = false;


                
                // 5.2 Receive normal program output
               

                child.stdout.on("data", (data) => {

                    stdout += data.toString();

                });


               
                // 5.3 Receive program error output
              

                child.stderr.on("data", (data) => {

                    stderr += data.toString();

                });


                
                // 5.4 Send input to the program
              

                if (input) {

                    child.stdin.write(input);

                }

                // Tell the program that no more input is coming
                child.stdin.end();


               
                // 6. EXECUTION TIMEOUT
                

                const timer = setTimeout(() => {

                    timedOut = true;

                    // Stop the running program
                    child.kill();


                    // Return timeout result
                    finish({
                        status: "timeout",
                        output: stdout,
                        error: "Execution timed out"
                    }).then(resolve);

                }, 5000);


               
                // 7. PROGRAM FINISHED
              

                child.on("close", (exitCode) => {

                    // Stop the timeout timer
                    clearTimeout(timer);


                   
                    // 7.1 If timeout already handled the result
                 

                    if (timedOut) {

                        return;

                    }


                    
                    // 7.2 Program ended with an error
                   
                    if (exitCode !== 0) {

                        finish({
                            status: "runtime_error",
                            output: stdout,
                            error: stderr
                        }).then(resolve);

                        return;
                    }


                    
                    // 7.3 Program executed successfully
                 

                    finish({
                        status: "success",
                        output: stdout,
                        error: null
                    }).then(resolve);

                });

            }
        );

    });
}



module.exports = { runCpp};