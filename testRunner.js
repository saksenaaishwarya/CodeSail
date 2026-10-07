//it fetch code and return result  

const { runCpp } = require("./cppRunner");      //require  cppRunner fun from cppRunner.js

async function main() {

    const code = `
#include <iostream>
using namespace std;
int main() {


 int a,b;
 cin>>a>>b;
 cout<<a+b;

    return 0;
}
`;

    const result = await runCpp(code,"10 20");

    console.log(result);
}

main();